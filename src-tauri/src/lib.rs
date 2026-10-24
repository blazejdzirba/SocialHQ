mod archive;
mod db;
mod media;

use base64::Engine as _;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::types::Value as SqlValue;
use rusqlite::params_from_iter;
use serde_json::{json, Map, Value};
use tauri::{Manager, State};

pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
    pub root: PathBuf,
    pub db_path: PathBuf,
    pub media_dir: PathBuf,
    pub thumbs_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub logs_dir: PathBuf,
    /// Cached column whitelist per table (filled from PRAGMA table_info).
    pub columns: Mutex<HashMap<String, HashSet<String>>>,
    /// Long-lived clipboard: on X11 the content dies with the Clipboard
    /// object, so we keep one alive for the whole app instead of per-copy.
    pub clipboard: Mutex<Option<arboard::Clipboard>>,
}

const TABLES: [&str; 16] = [
    "platforms",
    "projects",
    "project_briefs",
    "task_templates",
    "groups",
    "posts",
    "post_media",
    "media",
    "media_tags",
    "tags",
    "post_tags",
    "prompts",
    "prompt_tags",
    "group_publications",
    "group_tags",
    "settings",
];

/// Link (join) tables managed through the transactional `db_set_links`.
const LINK_TABLES: [&str; 5] = [
    "post_tags",
    "post_media",
    "media_tags",
    "prompt_tags",
    "group_tags",
];

fn table_allowed(table: &str) -> bool {
    TABLES.contains(&table)
}

fn link_table_allowed(table: &str) -> bool {
    LINK_TABLES.contains(&table)
}

/// Primary key column of a table (the brief is keyed by project, not by rowid).
fn primary_key(table: &str) -> &'static str {
    match table {
        "project_briefs" => "project_id",
        _ => "id",
    }
}

/// SQL identifiers (tables/columns) coming from the frontend must be plain
/// lowercase snake_case tokens; anything else is rejected before touching SQL.
fn valid_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn now_iso() -> String {
    let now = time::OffsetDateTime::now_utc();
    now.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::new())
}

pub fn now_stamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    let format = time::macros::format_description!(
        "[year]-[month]-[day]-[hour][minute][second]"
    );
    now.format(&format).unwrap_or_else(|_| String::new())
}

/// Appends a line to the log file inside the data directory. Used for errors
/// that must not be silent (e.g. failed backups) but must not crash the app.
pub fn log_error(state: &AppState, message: &str) {
    let line = format!("{} {}\n", now_iso(), message);
    let _ = fs::create_dir_all(&state.logs_dir)
        .and_then(|_| fs::write(state.logs_dir.join("socialhq.log"), line));
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn row_to_json(row: &rusqlite::Row<'_>, names: &[String]) -> Value {
    let mut map = Map::new();
    for (index, name) in names.iter().enumerate() {
        let value = match row.get_ref(index) {
            Ok(rusqlite::types::ValueRef::Null) => Value::Null,
            Ok(rusqlite::types::ValueRef::Integer(i)) => json!(i),
            Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
            Ok(rusqlite::types::ValueRef::Text(t)) => Value::String(String::from_utf8_lossy(t).to_string()),
            Ok(rusqlite::types::ValueRef::Blob(b)) => {
                Value::String(base64::engine::general_purpose::STANDARD.encode(b))
            }
            Err(_) => Value::Null,
        };
        map.insert(name.clone(), value);
    }
    Value::Object(map)
}

fn lock_conn(state: &AppState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    state.conn.lock().map_err(|_| "Wewnętrzny błąd blokady bazy danych.".to_string())
}

/// Returns the cached column whitelist for a table, reading it from the
/// database schema on first use.
fn table_columns(state: &AppState, table: &str) -> Result<HashSet<String>, String> {
    {
        let cache = state
            .columns
            .lock()
            .map_err(|_| "Wewnętrzny błąd pamięci schematu.".to_string())?;
        if let Some(columns) = cache.get(table) {
            return Ok(columns.clone());
        }
    }
    let conn = lock_conn(state)?;
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    let columns: HashSet<String> = rows.flatten().collect();
    drop(stmt);
    let mut cache = state
        .columns
        .lock()
        .map_err(|_| "Wewnętrzny błąd pamięci schematu.".to_string())?;
    cache.insert(table.to_string(), columns.clone());
    Ok(columns)
}

fn validated_columns(state: &AppState, table: &str, keys: &[String]) -> Result<(), String> {
    let columns = table_columns(state, table)?;
    for key in keys {
        if !valid_identifier(key) || !columns.contains(key) {
            return Err(format!("Nieznana kolumna „{key}” w tabeli {table}."));
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Table CRUD commands                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn db_all(state: State<AppState>, table: String) -> Result<Vec<Value>, String> {
    db_all_inner(&state, table)
}

fn db_all_inner(state: &AppState, table: String) -> Result<Vec<Value>, String> {
    if !table_allowed(&table) {
        return Err(format!("Nieznana tabela: {table}"));
    }
    let conn = lock_conn(state)?;
    let sql = format!("SELECT * FROM {table} ORDER BY rowid");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params![], |row| Ok(row_to_json(row, &names)))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn db_insert(state: State<AppState>, table: String, row: Value) -> Result<Value, String> {
    db_insert_inner(&state, table, row)
}

fn db_insert_inner(state: &AppState, table: String, row: Value) -> Result<Value, String> {
    if !table_allowed(&table) {
        return Err(format!("Nieznana tabela: {table}"));
    }
    let object = match row {
        Value::Object(map) => map,
        _ => return Err("Dane muszą być obiektem.".to_string()),
    };
    let mut keys: Vec<String> = Vec::new();
    let mut values: Vec<SqlValue> = Vec::new();
    for (key, value) in object.iter() {
        if value.is_null() {
            continue;
        }
        keys.push(key.clone());
        values.push(json_to_sql(value));
    }
    if keys.is_empty() {
        return Err("Brak danych do zapisu.".to_string());
    }
    validated_columns(state, &table, &keys)?;
    let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("INSERT INTO {table} ({}) VALUES ({placeholders})", keys.join(", "));
    let conn = lock_conn(state)?;
    conn.execute(&sql, params_from_iter(values.iter()))
        .map_err(|e| format!("Nie udało się zapisać danych: {e}"))?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table} WHERE rowid = ?1"))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = stmt.query_map(rusqlite::params![id], |r| Ok(row_to_json(r, &names)))
        .map_err(|e| e.to_string())?;
    let inserted = rows
        .next()
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or(Value::Null);
    Ok(inserted)
}

#[tauri::command]
fn db_update(
    state: State<AppState>,
    table: String,
    id: i64,
    patch: Value,
) -> Result<Value, String> {
    db_update_inner(&state, table, id, patch)
}

fn db_update_inner(state: &AppState, table: String, id: i64, patch: Value) -> Result<Value, String> {
    if !table_allowed(&table) {
        return Err(format!("Nieznana tabela: {table}"));
    }
    let object = match patch {
        Value::Object(map) => map,
        _ => return Err("Dane muszą być obiektem.".to_string()),
    };
    let mut keys: Vec<String> = Vec::new();
    let mut values: Vec<SqlValue> = Vec::new();
    for (key, value) in object.iter() {
        if value.is_null() {
            continue;
        }
        keys.push(key.clone());
        values.push(json_to_sql(value));
    }
    if keys.is_empty() {
        return Ok(Value::Null);
    }
    validated_columns(state, &table, &keys)?;
    let assignments = keys.iter().map(|k| format!("{k} = ?")).collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE {table} SET {assignments} WHERE {} = ?",
        primary_key(&table)
    );
    values.push(SqlValue::Integer(id));
    let conn = lock_conn(state)?;
    conn.execute(&sql, params_from_iter(values.iter()))
        .map_err(|e| format!("Nie udało się zapisać zmian: {e}"))?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT * FROM {table} WHERE {} = ?1",
            primary_key(&table)
        ))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = stmt.query_map(rusqlite::params![id], |r| Ok(row_to_json(r, &names)))
        .map_err(|e| e.to_string())?;
    let updated = rows
        .next()
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or(Value::Null);
    Ok(updated)
}

#[tauri::command]
fn db_delete(state: State<AppState>, table: String, id: i64) -> Result<(), String> {
    db_delete_inner(&state, table, id)
}

fn db_delete_inner(state: &AppState, table: String, id: i64) -> Result<(), String> {
    if !table_allowed(&table) {
        return Err(format!("Nieznana tabela: {table}"));
    }
    let conn = lock_conn(state)?;
    conn.execute(&format!("DELETE FROM {table} WHERE rowid = ?"), rusqlite::params![id])
        .map_err(|e| format!("Nie udało się usunąć rekordu: {e}"))?;
    Ok(())
}

/// Replaces all links of an owner in a join table, in a single transaction.
/// This replaces the former free-form `db_exec` (arbitrary SQL from the UI).
#[tauri::command]
fn db_set_links(
    state: State<AppState>,
    table: String,
    owner_column: String,
    owner_id: i64,
    linked_column: String,
    linked_ids: Vec<i64>,
) -> Result<(), String> {
    db_set_links_inner(&state, table, owner_column, owner_id, linked_column, linked_ids)
}

fn db_set_links_inner(
    state: &AppState,
    table: String,
    owner_column: String,
    owner_id: i64,
    linked_column: String,
    linked_ids: Vec<i64>,
) -> Result<(), String> {
    if !link_table_allowed(&table) {
        return Err(format!("Nieznana tabela powiązań: {table}"));
    }
    if !valid_identifier(&owner_column) || !valid_identifier(&linked_column) {
        return Err("Nieprawidłowa nazwa kolumny.".to_string());
    }
    validated_columns(state, &table, &[owner_column.clone(), linked_column.clone()])?;
    let mut conn = lock_conn(state)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Nie udało się rozpocząć transakcji: {e}"))?;
    tx.execute(
        &format!("DELETE FROM {table} WHERE {owner_column} = ?1"),
        rusqlite::params![owner_id],
    )
    .map_err(|e| format!("Nie udało się zapisać powiązań: {e}"))?;
    for linked_id in &linked_ids {
        tx.execute(
            &format!(
                "INSERT OR IGNORE INTO {table} ({owner_column}, {linked_column}) VALUES (?1, ?2)"
            ),
            rusqlite::params![owner_id, linked_id],
        )
        .map_err(|e| format!("Nie udało się zapisać powiązań: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("Nie udało się zapisać powiązań: {e}"))?;
    Ok(())
}

/// Creates or updates a single settings row (the table is keyed by `key`).
#[tauri::command]
fn db_set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    db_set_setting_inner(&state, key, value)
}

fn db_set_setting_inner(state: &AppState, key: String, value: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Klucz ustawienia nie może być pusty.".to_string());
    }
    let conn = lock_conn(state)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Nie udało się zapisać ustawienia: {e}"))?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

fn sanitize_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| term.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|term: &String| term.len() > 1)
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[tauri::command]
fn db_search(state: State<AppState>, query: String) -> Result<Vec<Value>, String> {
    let conn = lock_conn(&state)?;
    let fts_query = sanitize_fts_query(&query);

    if !fts_query.is_empty() {
        let sql = "SELECT entity_type, entity_id, title, snippet(search_fts, 3, '', '', '…', 14) AS snippet FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rank LIMIT 40";
        if let Ok(mut stmt) = conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![fts_query], |row| {
                Ok(json!({
                    "entity_type": row.get::<_, String>(0)?,
                    "entity_id": row.get::<_, i64>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "snippet": row.get::<_, String>(3)?,
                }))
            }) {
                let mut out = Vec::new();
                for row in rows.flatten() {
                    out.push(row);
                }
                if !out.is_empty() {
                    return Ok(out);
                }
            }
        }
    }

    // Fallback: simple LIKE search over the main tables.
    let pattern = format!("%{}%", query.trim());
    let sql = "SELECT 'post' AS entity_type, id AS entity_id, title AS title, substr(body, 1, 160) AS snippet FROM posts WHERE title LIKE ?1 OR body LIKE ?1
               UNION ALL
               SELECT 'group', id, name, coalesce(topic, '') FROM groups WHERE name LIKE ?1 OR topic LIKE ?1 OR rules LIKE ?1
               UNION ALL
               SELECT 'prompt', id, title, substr(body, 1, 160) FROM prompts WHERE title LIKE ?1 OR body LIKE ?1
               UNION ALL
               SELECT 'media', id, file_name, description FROM media WHERE file_name LIKE ?1 OR description LIKE ?1
               LIMIT 40";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![pattern], |row| {
            Ok(json!({
                "entity_type": row.get::<_, String>(0)?,
                "entity_id": row.get::<_, i64>(1)?,
                "title": row.get::<_, String>(2)?,
                "snippet": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows.flatten() {
        out.push(row);
    }
    Ok(out)
}

/* ------------------------------------------------------------------ */
/* OS integrations                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err("Brak adresu URL.".to_string());
    }
    std::process::Command::new("xdg-open")
        .arg(&trimmed)
        .spawn()
        .map_err(|e| format!("Nie udało się otworzyć adresu: {e}"))?;
    Ok(())
}

fn with_clipboard(
    state: &AppState,
) -> Result<std::sync::MutexGuard<'_, Option<arboard::Clipboard>>, String> {
    let mut guard = state
        .clipboard
        .lock()
        .map_err(|_| "Wewnętrzny błąd schowka.".to_string())?;
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| format!("Schowek niedostępny: {e}"))?);
    }
    Ok(guard)
}

#[tauri::command]
fn copy_text(state: State<AppState>, text: String) -> Result<(), String> {
    let mut clipboard = with_clipboard(&state)?;
    let clipboard = clipboard
        .as_mut()
        .ok_or_else(|| "Schowek niedostępny.".to_string())?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("Nie udało się skopiować tekstu: {e}"))?;
    Ok(())
}

/// Reads an image from the system clipboard (used by Ctrl+V in the media
/// library). Returns `null` when the clipboard holds no image.
#[tauri::command]
fn read_clipboard_image(state: State<AppState>) -> Result<Value, String> {
    let mut clipboard = with_clipboard(&state)?;
    let clipboard = clipboard
        .as_mut()
        .ok_or_else(|| "Schowek niedostępny.".to_string())?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(Value::Null),
    };
    let rgba = image::RgbaImage::from_raw(
        image.width as u32,
        image.height as u32,
        image.bytes.into_owned(),
    )
    .ok_or_else(|| "Nie udało się odczytać obrazu ze schowka.".to_string())?;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| format!("Nie udało się zapisać obrazu ze schowka: {e}"))?;
    Ok(json!({
        "data_base64": base64::engine::general_purpose::STANDARD.encode(png.into_inner()),
        "width": image.width,
        "height": image.height,
    }))
}

#[tauri::command]
fn copy_media(state: State<AppState>, id: i64) -> Result<(), String> {
    media::copy_to_clipboard(&state, id)
}

#[tauri::command]
fn show_in_folder(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = lock_conn(&state)?;
    let row = media::fetch_media(&conn, id)?;
    drop(conn);
    let relative = row["file_path"].as_str().unwrap_or_default().to_string();
    let absolute = state.root.join(relative);
    let folder = absolute.parent().map(|p| p.to_path_buf()).unwrap_or(state.root.clone());
    std::process::Command::new("xdg-open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("Nie udało się otworzyć folderu: {e}"))?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn import_media(
    state: State<AppState>,
    items: Vec<media::MediaImport>,
    project_id: Option<i64>,
    category: Option<String>,
) -> Result<Vec<Value>, String> {
    let category = category.unwrap_or_else(|| "inne".to_string());
    let conn = lock_conn(&state)?;
    let mut results = Vec::new();
    for item in &items {
        results.push(media::import_single(
            &conn,
            &state,
            item,
            project_id,
            &category,
        )?);
    }
    Ok(results)
}

#[tauri::command]
fn export_media(state: State<AppState>, id: i64) -> Result<String, String> {
    let row = {
        let conn = lock_conn(&state)?;
        media::fetch_media(&conn, id)?
    };
    let relative = row["file_path"].as_str().unwrap_or_default().to_string();
    let source = state.root.join(relative);
    let safe_name =
        media::sanitize_file_name(row["file_name"].as_str().unwrap_or("zdjecie"));
    fs::create_dir_all(&state.exports_dir).map_err(|e| e.to_string())?;
    let destination = state.exports_dir.join(safe_name);
    fs::copy(&source, &destination).map_err(|e| format!("Nie udało się skopiować pliku: {e}"))?;
    Ok(destination.to_string_lossy().to_string())
}

/* ------------------------------------------------------------------ */
/* Archives and backups                                                */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn export_archive(state: State<AppState>, destination: Option<String>) -> Result<String, String> {
    archive::export_archive(&state, destination)
}

#[tauri::command]
fn import_archive(
    state: State<AppState>,
    path: String,
    bytes_b64: Option<String>,
) -> Result<(), String> {
    // Payload mode: the frontend may upload archive bytes directly (IPC path
    // instead of a filesystem path).
    if path.trim().is_empty() {
        if let Some(bytes_b64) = bytes_b64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64)
                .map_err(|e| format!("Nieprawidłowe dane archiwum: {e}"))?;
            let tmp = state
                .root
                .join(format!("tmp-import-{}.zip", uuid::Uuid::new_v4()));
            fs::write(&tmp, &bytes)
                .map_err(|e| format!("Nie udało się zapisać archiwum: {e}"))?;
            let tmp_path = tmp.to_string_lossy().to_string();
            let result = archive::import_archive(&state, &tmp_path);
            let _ = fs::remove_file(&tmp_path);
            return result;
        }
        return Err("Nie przekazano pliku archiwum.".to_string());
    }
    archive::import_archive(&state, &path)
}

#[tauri::command]
fn create_backup(state: State<AppState>) -> Result<String, String> {
    archive::create_backup(&state)
}

#[tauri::command]
fn list_backups(state: State<AppState>) -> Result<Vec<Value>, String> {
    archive::list_backups(&state)
}

#[tauri::command]
fn restore_backup(state: State<AppState>, path: String) -> Result<(), String> {
    archive::restore_backup(&state, &path)
}

#[tauri::command]
fn data_paths(state: State<AppState>) -> Result<Value, String> {
    Ok(json!({
        "root": state.root.to_string_lossy(),
        "database": state.db_path.to_string_lossy(),
        "media": state.media_dir.to_string_lossy(),
        "backups": state.backups_dir.to_string_lossy(),
        "exports": state.exports_dir.to_string_lossy(),
        "backend": "tauri",
    }))
}

#[tauri::command]
fn open_data_folder(state: State<AppState>) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(&state.root)
        .spawn()
        .map_err(|e| format!("Nie udało się otworzyć folderu: {e}"))?;
    Ok(())
}

#[tauri::command]
fn create_backup_on_exit(state: State<AppState>) -> Result<(), String> {
    archive::create_backup(&state).map(|_| ())
}

/* ------------------------------------------------------------------ */
/* App entry                                                           */
/* ------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = match app.path().app_data_dir() {
                Ok(path) => path,
                Err(_) => dirs::data_dir()
                    .ok_or("Nie udało się ustalić katalogu danych aplikacji.")?
                    .join("pl.socialhq.desktop"),
            };
            let media_dir = root.join("media");
            let thumbs_dir = root.join("thumbs");
            let backups_dir = root.join("backups");
            let exports_dir = root.join("exports");
            let logs_dir = root.join("logs");
            let db_path = root.join("db").join("socialhq.db");
            for dir in [&media_dir, &thumbs_dir, &backups_dir, &exports_dir, &logs_dir] {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let db_parent = db_path
                .parent()
                .map(|p| p.to_path_buf())
                .ok_or("Nieprawidłowa ścieżka bazy danych.")?;
            fs::create_dir_all(db_parent).map_err(|e| e.to_string())?;

            let conn = db::open(&db_path)?;
            db::migrate(&conn)?;

            app.manage(AppState {
                conn: Mutex::new(conn),
                root,
                db_path,
                media_dir,
                thumbs_dir,
                backups_dir,
                exports_dir,
                logs_dir,
                columns: Mutex::new(HashMap::new()),
                clipboard: Mutex::new(None),
            });

            // Consistency backup at startup (best-effort, never blocks start).
            let state: State<AppState> = app.state();
            if let Err(err) = archive::create_backup(&state) {
                log_error(&state, &format!("Backup przy starcie nie powiódł się: {err}"));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if let Err(err) = archive::create_backup(&state) {
                        log_error(&state, &format!("Backup przy zamknięciu nie powiódł się: {err}"));
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            db_all,
            db_insert,
            db_update,
            db_delete,
            db_set_links,
            db_set_setting,
            db_search,
            open_external,
            copy_text,
            read_clipboard_image,
            copy_media,
            show_in_folder,
            export_media,
            import_media,
            export_archive,
            import_archive,
            create_backup,
            create_backup_on_exit,
            list_backups,
            restore_backup,
            data_paths,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("Nie udało się uruchomić SocialHQ");
}

#[cfg(test)]
pub(crate) fn test_app_state(dir: &std::path::Path) -> AppState {
    let db_path = dir.join("db").join("socialhq.db");
    fs::create_dir_all(&db_path.parent().unwrap()).unwrap();
    let conn = db::open(&db_path).unwrap();
    db::migrate(&conn).unwrap();
    AppState {
        conn: Mutex::new(conn),
        root: dir.to_path_buf(),
        db_path,
        media_dir: dir.join("media"),
        thumbs_dir: dir.join("thumbs"),
        backups_dir: dir.join("backups"),
        exports_dir: dir.join("exports"),
        logs_dir: dir.join("logs"),
        columns: Mutex::new(HashMap::new()),
        clipboard: Mutex::new(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_validated() {
        assert!(valid_identifier("posts"));
        assert!(valid_identifier("_private"));
        assert!(valid_identifier("tag_id"));
        assert!(!valid_identifier("Posts"));
        assert!(!valid_identifier("drop table"));
        assert!(!valid_identifier("id;--"));
        assert!(!valid_identifier(""));
        assert!(!valid_identifier("1abc"));
    }

    #[test]
    fn insert_rejects_unknown_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        let result = db_insert_inner(
            &state,
            "posts".into(),
            json!({"title": "x", "evil_column": "y"}),
        );
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("evil_column"));
    }

    #[test]
    fn insert_rejects_unknown_table_and_uppercase_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        let result = db_insert_inner(&state, "sqlite_master".into(), json!({"name": "x"}));
        assert!(result.is_err());
        let result = db_insert_inner(&state, "posts".into(), json!({"Title": "x"}));
        assert!(result.is_err());
    }

    #[test]
    fn update_rejects_unknown_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        let result = db_update_inner(&state, "posts".into(), 1, json!({"nope": "x"}));
        assert!(result.is_err());
    }

    #[test]
    fn set_links_replaces_in_transaction() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        // Parent project row (posts.project_id is a real foreign key).
        state
            .conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, platform, color, created_at) VALUES (1, 'Test', 'facebook', '#BFEF00', '2026-01-01')",
                [],
            )
            .unwrap();
        // Rows the links will point to (tag_id/media_id are real FKs).
        {
            let conn = state.conn.lock().unwrap();
            for (id, name) in [(1, "a"), (2, "b"), (3, "c"), (7, "g")] {
                conn.execute("INSERT INTO tags (id, name) VALUES (?1, ?2)", rusqlite::params![id, name])
                    .unwrap();
            }
            for id in [1, 2, 3] {
                conn.execute(
                    "INSERT INTO media (id, project_id, category, file_name, file_path, thumb_path, sha256, created_at)
                     VALUES (?1, 1, 'inne', 'f.png', 'media/f.png', 'thumbs/f.jpg', 'hash', '2026-01-01')",
                    rusqlite::params![id],
                )
                .unwrap();
            }
        }
        let post = db_insert_inner(
            &state,
            "posts".into(),
            json!({
                "project_id": 1,
                "title": "t",
                "body": "b",
                "kind": "page",
                "status": "idea",
                "created_at": now_iso(),
                "updated_at": now_iso()
            }),
        )
        .unwrap();
        let post_id = post["id"].as_i64().unwrap();

        for table in ["post_tags", "post_media"] {
            let linked_column = if table == "post_tags" { "tag_id" } else { "media_id" };
            let result = db_set_links_inner(
                &state,
                table.into(),
                "post_id".into(),
                post_id,
                linked_column.into(),
                vec![1, 2, 3],
            );
            assert!(result.is_ok(), "{table}: {result:?}");
            let rows = db_all_inner(&state, table.into()).unwrap();
            assert_eq!(rows.len(), 3, "{table}");
        }

        // Second call replaces links instead of duplicating them.
        db_set_links_inner(
            &state,
            "post_tags".into(),
            "post_id".into(),
            post_id,
            "tag_id".into(),
            vec![7],
        )
        .unwrap();
        let rows = db_all_inner(&state, "post_tags".into()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["tag_id"].as_i64(), Some(7));

        // Unknown link table is rejected.
        let result = db_set_links_inner(
            &state,
            "posts".into(),
            "post_id".into(),
            post_id,
            "tag_id".into(),
            vec![1],
        );
        assert!(result.is_err());
    }

    #[test]
    fn set_setting_upserts() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        db_set_setting_inner(&state, "media_categories".into(), "[\"a\"]".into()).unwrap();
        db_set_setting_inner(&state, "media_categories".into(), "[\"b\"]".into()).unwrap();
        let rows = db_all_inner(&state, "settings".into()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["value"].as_str(), Some("[\"b\"]"));
    }

    #[test]
    fn sanitize_fts_query_builds_prefixed_phrases() {
        assert_eq!(sanitize_fts_query("pomys"), "\"pomys\"*");
        assert_eq!(sanitize_fts_query("Trzeźw-ść !"), "\"Trzeźwść\"*");
        assert_eq!(sanitize_fts_query("!!"), "");
    }
}
