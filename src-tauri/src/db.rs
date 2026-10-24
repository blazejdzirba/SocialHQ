use std::path::Path;

use rusqlite::Connection;

/// Canonical schema migrations. Parsed into numbered blocks at runtime.
pub const MIGRATIONS_SQL: &str = include_str!("migrations.sql");

/// Splits the migration file into `(version, sql)` blocks.
pub fn split_migrations(src: &str) -> Vec<(u32, String)> {
    let mut blocks: Vec<(u32, String)> = Vec::new();
    let mut current: Option<(u32, String)> = None;

    for line in src.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("-- migration:") {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            let version = rest
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(1);
            current = Some((version, String::new()));
        } else if let Some((_, body)) = current.as_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    if let Some(block) = current {
        blocks.push(block);
    }
    blocks
}

/// Applies pending migrations. The FTS migration is optional: when the SQLite
/// build has no FTS5 support the app still works with a LIKE based search.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    for (version, sql) in split_migrations(MIGRATIONS_SQL) {
        if version <= current {
            continue;
        }
        let optional = sql.to_lowercase().contains("fts5");
        match conn.execute_batch(&sql) {
            Ok(()) => {
                conn.pragma_update(None, "user_version", version)
                    .map_err(|e| format!("Nie udało się zapisać wersji migracji: {e}"))?;
                log::info!("Zastosowano migrację {version}");
            }
            Err(err) if optional => {
                log::warn!("Pominięto migrację {version} (brak FTS5): {err}");
            }
            Err(err) => {
                return Err(format!("Migracja {version} nie powiodła się: {err}"));
            }
        }
    }
    Ok(())
}

/// Opens the SQLite database with sane pragmas. PRAGAs that return a row
/// (`journal_mode`) must go through `pragma_update`, not `execute_batch` —
/// the latter fails with "Execute returned results".
pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    // `journal_mode` returns the new mode as a row, so it needs query_row;
    // the remaining pragmas return no rows.
    let _: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
        .map_err(|e| format!("Nie udało się włączyć trybu WAL: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(conn: &Connection) -> u32 {
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
                rusqlite::params![name],
                |row| row.get(0),
            )
            .unwrap();
        count > 0
    }

    #[test]
    fn split_migrations_parses_numbered_blocks() {
        let blocks = split_migrations(MIGRATIONS_SQL);
        assert!(blocks.len() >= 4);
        let versions: Vec<u32> = blocks.iter().map(|(v, _)| *v).collect();
        assert!(versions.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn migrate_applies_all_blocks_on_empty_database() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(version(&conn), split_migrations(MIGRATIONS_SQL).len() as u32);
        for table in [
            "platforms", "projects", "project_briefs", "task_templates", "groups", "posts",
            "media", "prompts", "tags", "post_tags", "post_media", "media_tags", "prompt_tags",
            "group_publications", "group_tags", "settings", "search_fts",
        ] {
            assert!(table_exists(&conn, table), "missing table: {table}");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let before = version(&conn);
        migrate(&conn).unwrap();
        assert_eq!(version(&conn), before);
        let triggers: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_fts_ai'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(triggers, 1);
    }

    #[test]
    fn open_creates_parent_directories_and_enables_foreign_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nested/deeper/socialhq.db");
        let conn = open(&path).unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        assert!(path.exists());
    }
}
