use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::AppState;

fn options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

/// Hard cap on the total uncompressed size accepted during import.
const MAX_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Entry prefixes allowed inside a workspace archive; everything else is
/// ignored, so a malicious archive cannot touch arbitrary paths.
const ALLOWED_PREFIXES: [&str; 3] = ["db/", "media/", "thumbs/"];

fn checkpoint(state: &AppState) {
    if let Ok(conn) = state.conn.lock() {
        // wal_checkpoint returns a row, so it needs query_row (execute_batch
        // would refuse to run it).
        let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()));
    }
}

/// Writes a consistent snapshot of the live database into `target` using
/// `VACUUM INTO` — safe while the connection is open (a raw file copy of a
/// database in WAL mode is not).
pub fn snapshot_database(state: &AppState, target: &Path) -> Result<(), String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Wewnętrzny błąd bazy danych.".to_string())?;
    // VACUUM INTO refuses to overwrite an existing file.
    let _ = fs::remove_file(target);
    conn.execute_batch(&format!(
        "VACUUM INTO '{}'",
        target.to_string_lossy().replace('\'', "''")
    ))
    .map_err(|e| format!("Nie udało się zrobić spójnego snapshotu bazy: {e}"))?;
    Ok(())
}

/// Writes the whole workspace (database snapshot + media) into a single zip.
pub fn export_archive(state: &AppState, destination: Option<String>) -> Result<String, String> {
    checkpoint(state);

    let stamp = crate::now_stamp();
    let export_dir = state.root.join("exports");
    fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;
    let default_path = export_dir.join(format!("socialhq-export-{stamp}.zip"));
    let target = match destination {
        Some(dest) if !dest.trim().is_empty() => PathBuf::from(dest),
        _ => default_path.clone(),
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let snapshot_path = state.root.join(format!("tmp-export-{stamp}.db"));
    let result = (|| -> Result<(), String> {
        snapshot_database(state, &snapshot_path)?;

        let file = File::create(&target).map_err(|e| format!("Nie udało się utworzyć pliku: {e}"))?;
        let mut zip = ZipWriter::new(file);

        let mut buffer = Vec::new();
        File::open(&snapshot_path)
            .map_err(|e| e.to_string())?
            .read_to_end(&mut buffer)
            .map_err(|e| e.to_string())?;
        zip.start_file("db/socialhq.db", options()).map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;

        for (folder, archive_folder) in [("media", "media"), ("thumbs", "thumbs")] {
            let dir = state.root.join(folder);
            if !dir.exists() {
                continue;
            }
            for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if !entry.path().is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                let mut buffer = Vec::new();
                File::open(entry.path())
                    .map_err(|e| e.to_string())?
                    .read_to_end(&mut buffer)
                    .map_err(|e| e.to_string())?;
                zip.start_file(format!("{archive_folder}/{name}"), options())
                    .map_err(|e| e.to_string())?;
                zip.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }

        let manifest = json!({
            "app": "SocialHQ",
            "version": env!("CARGO_PKG_VERSION"),
            "exported_at": crate::now_iso(),
            "media_count": fs::read_dir(state.root.join("media")).map(|d| d.count()).unwrap_or(0),
        });
        zip.start_file("manifest.json", options()).map_err(|e| e.to_string())?;
        zip.write_all(manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;

        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();

    let _ = fs::remove_file(&snapshot_path);
    result?;
    Ok(target.to_string_lossy().to_string())
}

/// Validates that the file behind `path` is a real database with a schema
/// version this build understands. Returns the user_version after migration.
fn validate_database_file(path: &Path) -> Result<u32, String> {
    let conn = crate::db::open(path)?;
    crate::db::migrate(&conn)?;
    let version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("Baza w archiwum jest uszkodzona: {e}"))?;
    if version < 1 {
        return Err("Baza w archiwum ma nieprawidłową wersję schematu.".to_string());
    }
    // Flush any WAL content into the main file before it gets copied around.
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()));
    Ok(version)
}

/// Restores a workspace from a zip archive (existing data is overwritten).
/// The archive is fully validated *before* anything is replaced; on failure
/// the previous state is restored (a safety backup is also made up front).
pub fn import_archive(state: &AppState, path: &str) -> Result<(), String> {
    let archive_path = PathBuf::from(path);
    if !archive_path.exists() {
        return Err("Nie znaleziono pliku archiwum.".to_string());
    }

    // Safety net: keep a backup of the current state before overwriting it.
    let _ = create_backup(state);

    // ---- 1) Read and validate the archive in memory. -------------------
    let file = File::open(&archive_path).map_err(|e| format!("Nie udało się otworzyć archiwum: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Nieprawidłowe archiwum: {e}"))?;

    let mut db_entry: Option<Vec<u8>> = None;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let normalized = name.replace('\\', "/");
        // Zip-slip guard: reject absolute paths and any ".." component.
        if normalized.starts_with('/')
            || normalized.split('/').any(|part| part == "..")
        {
            continue;
        }
        if !ALLOWED_PREFIXES.iter().any(|prefix| normalized.starts_with(prefix)) {
            continue;
        }
        let mut buffer = Vec::new();
        entry.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        total += buffer.len() as u64;
        if total > MAX_ARCHIVE_BYTES {
            return Err("Archiwum jest zbyt duże, żeby je bezpiecznie zaimportować.".to_string());
        }
        if normalized == "db/socialhq.db" {
            db_entry = Some(buffer);
            continue;
        }
        // Stale sidecars ("-wal"/"-shm") and any other db/ entries from an old
        // export must never be restored — only the main database file.
        if normalized.starts_with("db/") {
            continue;
        }
        files.push((normalized, buffer));
    }

    let db_bytes = db_entry.ok_or_else(|| "Archiwum nie zawiera bazy danych (db/socialhq.db).".to_string())?;

    // ---- 2) The replacement database must open and migrate cleanly. ----
    let stamp = crate::now_stamp();
    let staging = state.root.join(format!("tmp-import-{stamp}.db"));
    fs::write(&staging, &db_bytes).map_err(|e| format!("Nie udało się zapisać bazy z archiwum: {e}"))?;
    let validation = validate_database_file(&staging);
    if let Err(err) = validation {
        let _ = fs::remove_file(&staging);
        return Err(err);
    }

    // ---- 3) Swap files with rollback support. --------------------------
    let db_backup = state.root.join("db/socialhq.db.pre-import");
    let wal = state.root.join("db/socialhq.db-wal");
    let shm = state.root.join("db/socialhq.db-shm");

    let swap: Result<(), String> = (|| {
        let mut guard = state
            .conn
            .lock()
            .map_err(|_| "Wewnętrzny błąd bazy danych.".to_string())?;
        let _ = guard.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()));

        if state.db_path.exists() {
            fs::copy(&state.db_path, &db_backup)
                .map_err(|e| format!("Nie udało się zabezpieczyć bieżącej bazy: {e}"))?;
        }
        // Dropping the live connection: replace it with an in-memory one so
        // the files can be swapped while still holding the lock.
        *guard = rusqlite::Connection::open_in_memory()
            .map_err(|e| format!("Nie udało się zamknąć bazy danych: {e}"))?;

        let _ = fs::remove_file(&wal);
        let _ = fs::remove_file(&shm);
        // A stale WAL/SHM left next to the staging copy must not leak into it.
        let _ = fs::remove_file(PathBuf::from(format!("{}-wal", staging.to_string_lossy())));
        let _ = fs::remove_file(PathBuf::from(format!("{}-shm", staging.to_string_lossy())));
        fs::copy(&staging, &state.db_path)
            .map_err(|e| format!("Nie udało się podmienić bazy danych: {e}"))?;

        for (name, bytes) in &files {
            let destination = state.root.join(name);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&destination, bytes)
                .map_err(|e| format!("Nie udało się wypisać pliku {name}: {e}"))?;
        }

        let fresh = crate::db::open(&state.db_path)?;
        crate::db::migrate(&fresh)?;
        *guard = fresh;
        Ok(())
    })();

    let _ = fs::remove_file(&staging);
    match swap {
        Ok(()) => {
            let _ = fs::remove_file(&db_backup);
            Ok(())
        }
        Err(err) => {
            // Rollback to the pre-import state.
            let rollback = (|| -> Result<(), String> {
                let mut guard = state
                    .conn
                    .lock()
                    .map_err(|_| "Wewnętrzny błąd bazy danych.".to_string())?;
                let _ = fs::remove_file(&wal);
                let _ = fs::remove_file(&shm);
                if db_backup.exists() {
                    fs::copy(&db_backup, &state.db_path)
                        .map_err(|e| format!("Nie udało się przywrócić bazy: {e}"))?;
                }
                let conn = crate::db::open(&state.db_path)?;
                crate::db::migrate(&conn)?;
                *guard = conn;
                Ok(())
            })();
            let _ = fs::remove_file(&db_backup);
            match rollback {
                Ok(()) => Err(format!(
                    "Import nie powiódł się — przywrócono poprzednie dane. Szczegóły: {err}"
                )),
                Err(rollback_err) => Err(format!(
                    "Import nie powiódł się i przywrócenie poprzednich danych też: {rollback_err}. Kopia bezpieczeństwa jest w backups/. Szczegóły importu: {err}"
                )),
            }
        }
    }
}

/// Restores a database backup created by `create_backup` (same safe path as
/// a full import). Only files inside the backups directory are accepted.
pub fn restore_backup(state: &AppState, path: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    let canonical = path.canonicalize().map_err(|_| "Nie znaleziono kopii zapasowej.".to_string())?;
    let backups = state.backups_dir.canonicalize().unwrap_or(state.backups_dir.clone());
    if !canonical.starts_with(&backups) {
        return Err("Dozwolone jest przywracanie tylko z folderu kopii zapasowych.".to_string());
    }
    import_archive(state, &canonical.to_string_lossy())
}

/// Creates a timestamped database backup (consistent snapshot) and keeps only
/// the five newest ones.
pub fn create_backup(state: &AppState) -> Result<String, String> {
    checkpoint(state);
    let backup_dir = state.backups_dir.clone();
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let stamp = crate::now_stamp();
    // Two backups within one second (e.g. the safety copy made right before an
    // import) must not clobber each other, so we add a numeric suffix.
    let mut target = backup_dir.join(format!("socialhq-{stamp}.zip"));
    let mut suffix: u32 = 0;
    while target.exists() {
        suffix += 1;
        target = backup_dir.join(format!("socialhq-{stamp}-{suffix}.zip"));
    }

    let snapshot_path = state.root.join(format!("tmp-backup-{stamp}.db"));
    let result = (|| -> Result<(), String> {
        snapshot_database(state, &snapshot_path)?;
        let file = File::create(&target).map_err(|e| format!("Nie udało się utworzyć kopii: {e}"))?;
        let mut zip = ZipWriter::new(file);
        let mut buffer = Vec::new();
        File::open(&snapshot_path)
            .map_err(|e| e.to_string())?
            .read_to_end(&mut buffer)
            .map_err(|e| e.to_string())?;
        zip.start_file("db/socialhq.db", options()).map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_file(&snapshot_path);
    result?;

    prune_backups(state, 5);
    Ok(target.to_string_lossy().to_string())
}

/// Keeps the newest `keep` zip files in the backups directory. Files are named
/// `socialhq-YYYYMMDD-HHMMSS.zip`, so lexicographic order is chronological.
pub fn prune_backups(state: &AppState, keep: usize) {
    let mut files: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&state.backups_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "zip").unwrap_or(false) {
                files.push(path);
            }
        }
    }
    files.sort();
    files.reverse();
    for path in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

pub fn list_backups(state: &AppState) -> Result<Vec<Value>, String> {
    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(&state.backups_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "zip").unwrap_or(false) {
                let metadata = entry.metadata().ok();
                let modified = metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let dt: time::OffsetDateTime = t.into();
                        dt.format(&time::format_description::well_known::Rfc3339)
                            .unwrap_or_default()
                    })
                    .unwrap_or_default();
                items.push(json!({
                    "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    "path": path.to_string_lossy(),
                    "size": metadata.map(|m| m.len()).unwrap_or(0),
                    "created_at": modified,
                }));
            }
        }
    }
    items.sort_by(|a, b| b["created_at"].as_str().unwrap_or("").cmp(a["created_at"].as_str().unwrap_or("")));
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_app_state;
    use std::io::Write as _;

    fn add_project(state: &AppState, name: &str) {
        let conn = state.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (name, platform, color, created_at) VALUES (?1, 'facebook', '#BFEF00', '2026-01-01')",
            rusqlite::params![name],
        )
        .unwrap();
    }

    fn project_count(state: &AppState) -> i64 {
        let conn = state.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn backup_rotation_keeps_five_newest() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        fs::create_dir_all(&state.backups_dir).unwrap();
        // Pre-create 8 zips with deterministic, chronologically sorted names
        // (backup names are `socialhq-YYYYMMDD-HHMMSS.zip`, so a lexicographic
        // sort is a time sort).
        for index in 0..8 {
            let path = state.backups_dir.join(format!("socialhq-2026010{index}-000000.zip"));
            let mut file = File::create(&path).unwrap();
            file.write_all(b"backup").unwrap();
        }
        prune_backups(&state, 5);
        let left = fs::read_dir(&state.backups_dir).unwrap().count();
        assert_eq!(left, 5);
        // The newest must survive, the oldest must go.
        assert!(state.backups_dir.join("socialhq-20260107-000000.zip").exists());
        assert!(!state.backups_dir.join("socialhq-20260100-000000.zip").exists());
    }

    #[test]
    fn backup_zip_contains_consistent_database() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        add_project(&state, "SoberBro");

        let path = create_backup(&state).unwrap();
        let file = File::open(&path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut db_entry = archive.by_name("db/socialhq.db").unwrap();
        let mut bytes = Vec::new();
        db_entry.read_to_end(&mut bytes).unwrap();

        let tmp_db = tmp.path().join("check.db");
        fs::write(&tmp_db, &bytes).unwrap();
        let conn = rusqlite::Connection::open(&tmp_db).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE name = 'SoberBro'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn import_archive_accepts_valid_and_rejects_hostile() {
        let tmp = tempfile::tempdir().unwrap();
        let source_state = test_app_state(&tmp.path().join("source"));
        add_project(&source_state, "Importowany");
        let archive_path = export_archive(&source_state, None).unwrap();

        let target_tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(target_tmp.path());
        add_project(&state, "Istniejacy");

        import_archive(&state, &archive_path).unwrap();
        assert_eq!(project_count(&state), 1);
        let name: String = {
            let conn = state.conn.lock().unwrap();
            conn.query_row("SELECT name FROM projects LIMIT 1", [], |row| row.get(0))
                .unwrap()
        };
        assert_eq!(name, "Importowany");

        // Malicious archive: path traversal entry must be ignored, missing db
        // must be rejected without destroying current data.
        let evil_path = target_tmp.path().join("evil.zip");
        let file = File::create(&evil_path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.start_file("../../.ssh/authorized_keys", options()).unwrap();
        zip.write_all(b"evil").unwrap();
        zip.finish().unwrap();
        let result = import_archive(&state, &evil_path.to_string_lossy());
        assert!(result.is_err());
        assert_eq!(project_count(&state), 1);
        assert!(!target_tmp.path().join(".ssh").exists());

        // Corrupt zip is rejected cleanly.
        let broken_path = target_tmp.path().join("broken.zip");
        fs::write(&broken_path, b"this is not a zip").unwrap();
        let result = import_archive(&state, &broken_path.to_string_lossy());
        assert!(result.is_err());
        assert_eq!(project_count(&state), 1);
    }

    #[test]
    fn restore_backup_swaps_database() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        add_project(&state, "Przed");
        let backup = create_backup(&state).unwrap();

        add_project(&state, "Po");
        assert_eq!(project_count(&state), 2);

        restore_backup(&state, &backup).unwrap();
        assert_eq!(project_count(&state), 1);

        // Refuses paths outside the backups directory.
        let outside = tmp.path().join("outside.zip");
        fs::write(&outside, b"x").unwrap();
        let result = restore_backup(&state, &outside.to_string_lossy());
        assert!(result.is_err());
    }
}
