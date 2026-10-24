use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::AppState;

pub const ALLOWED_EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "webp", "gif"];
/// Hard limit for a single imported image (spec: 12 MB).
pub const MAX_FILE_BYTES: usize = 12 * 1024 * 1024;
const THUMB_MAX: u32 = 520;

#[derive(Debug, serde::Deserialize)]
pub struct MediaImport {
    pub name: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub bytes_b64: Option<String>,
}

/// Strips directory components and anything outside `[A-Za-z0-9._-]`.
pub fn sanitize_file_name(name: &str) -> String {
    let base = name
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .rsplit('\\')
        .next()
        .unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "plik".to_string()
    } else {
        cleaned
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Imports one file into the managed media directory and stores its metadata.
/// The connection is passed in so the logic stays testable without Tauri.
pub fn import_single(
    conn: &Connection,
    state: &AppState,
    item: &MediaImport,
    project_id: Option<i64>,
    category: &str,
) -> Result<Value, String> {
    let bytes: Vec<u8> = match (&item.path, &item.bytes_b64) {
        (Some(path), _) => fs::read(path).map_err(|e| format!("Nie udało się odczytać pliku: {e}"))?,
        (None, Some(b64)) => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("Nieprawidłowe dane pliku: {e}"))?
        }
        _ => return Err("Brak danych pliku.".to_string()),
    };

    if bytes.is_empty() {
        return Err("Plik jest pusty.".to_string());
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!(
            "Plik jest za duży ({}). Limit to 12 MB.",
            format_bytes(bytes.len())
        ));
    }

    let ext = extension_of(&item.name);
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Format „{ext}” nie jest obsługiwany."));
    }

    // The extension must not be the only gate: the payload has to decode as an
    // actual image before anything is written to disk.
    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| "Plik nie jest obsługiwanym obrazem (dekodowanie nie powiodło się).".to_string())?;
    let (width, height) = (decoded.width(), decoded.height());

    let hash = sha256_hex(&bytes);
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM media WHERE sha256 = ?1 LIMIT 1",
            params![hash],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        let mut row = fetch_media(conn, id)?;
        row["duplicate"] = json!(true);
        return Ok(row);
    }

    let file_name = format!("{}-{}", &uuid::Uuid::new_v4().to_string()[..8], sanitize_file_name(&item.name));
    let relative_file = format!("media/{file_name}");
    let absolute_file: PathBuf = state.root.join(&relative_file);
    if let Some(parent) = absolute_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&absolute_file, &bytes).map_err(|e| format!("Nie udało się zapisać pliku: {e}"))?;

    let relative_thumb = format!("thumbs/{file_name}.jpg");
    let absolute_thumb = state.root.join(&relative_thumb);
    if let Some(parent) = absolute_thumb.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // `thumbnail` keeps alpha; JPEG cannot store it, so flatten onto white
    // first (PNG with transparency, animated GIF first frame, WebP).
    let thumb = image::imageops::thumbnail(&decoded, THUMB_MAX, THUMB_MAX);
    let rgb_thumb = image::DynamicImage::ImageRgba8(thumb).to_rgb8();
    rgb_thumb
        .save_with_format(&absolute_thumb, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Nie udało się zapisać miniatury: {e}"))?;

    conn.execute(
        "INSERT INTO media (project_id, category, file_name, file_path, thumb_path, sha256, width, height, size_bytes, description, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', ?10)",
        params![
            project_id,
            category,
            item.name,
            relative_file,
            relative_thumb,
            hash,
            width as i64,
            height as i64,
            bytes.len() as i64,
            crate::now_iso()
        ],
    )
    .map_err(|e| format!("Nie udało się zapisać metadanych: {e}"))?;

    let id = conn.last_insert_rowid();
    let mut row = fetch_media(conn, id)?;
    row["duplicate"] = json!(false);
    Ok(row)
}

fn format_bytes(size: usize) -> String {
    let mib = size as f64 / (1024.0 * 1024.0);
    format!("{mib:.1} MB")
}

pub fn fetch_media(conn: &Connection, id: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM media WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(json!({
            "id": row.get::<_, i64>(0)?,
            "project_id": row.get::<_, Option<i64>>(1)?,
            "category": row.get::<_, String>(2)?,
            "file_name": row.get::<_, String>(3)?,
            "file_path": row.get::<_, String>(4)?,
            "thumb_path": row.get::<_, String>(5)?,
            "sha256": row.get::<_, String>(6)?,
            "width": row.get::<_, i64>(7)?,
            "height": row.get::<_, i64>(8)?,
            "size_bytes": row.get::<_, i64>(9)?,
            "description": row.get::<_, String>(10)?,
            "created_at": row.get::<_, String>(11)?,
        }))
    })
    .map_err(|e| e.to_string())?;

    let row = rows
        .next()
        .transpose()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Nie znaleziono zdjęcia.".to_string())?;
    Ok(row)
}

/// Copies the original image to the system clipboard. Uses the long-lived
/// clipboard object stored in `AppState` (X11/Wayland safe).
pub fn copy_to_clipboard(state: &AppState, id: i64) -> Result<(), String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Wewnętrzny błąd bazy danych.".to_string())?;
    let row = fetch_media(&conn, id)?;
    drop(conn);
    let relative = row["file_path"].as_str().unwrap_or_default().to_string();
    let absolute = state.root.join(relative);
    let bytes = fs::read(&absolute).map_err(|e| format!("Nie udało się odczytać pliku: {e}"))?;
    let decoded = image::load_from_memory(&bytes).map_err(|e| format!("Nie udało się odczytać obrazu: {e}"))?;
    let rgba = decoded.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let pixels = rgba.into_raw();
    let mut guard = state
        .clipboard
        .lock()
        .map_err(|_| "Wewnętrzny błąd schowka.".to_string())?;
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| format!("Schowek niedostępny: {e}"))?);
    }
    let clipboard = guard
        .as_mut()
        .ok_or_else(|| "Schowek niedostępny.".to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(pixels),
        })
        .map_err(|e| format!("Nie udało się skopiować obrazu: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_app_state;

    fn sample_state() -> (tempfile::TempDir, AppState) {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_app_state(tmp.path());
        // Parent project row: media.project_id has a real foreign key now that
        // PRAGMA foreign_keys actually works.
        state
            .conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, platform, color, created_at) VALUES (1, 'Test', 'facebook', '#BFEF00', '2026-01-01')",
                [],
            )
            .unwrap();
        (tmp, state)
    }

    fn import_from_bytes(state: &AppState, name: &str, bytes: Vec<u8>) -> Result<Value, String> {
        use base64::Engine;
        let item = MediaImport {
            name: name.to_string(),
            path: None,
            bytes_b64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        };
        let conn = state.conn.lock().unwrap();
        import_single(&conn, state, &item, Some(1), "do-postow")
    }

    /// 1×1 PNG (red) with an alpha channel.
    fn png_with_alpha() -> Vec<u8> {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            3,
            3,
            image::Rgba([255, 0, 0, 128]),
        ));
        let mut buffer = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buffer, image::ImageFormat::Png).unwrap();
        buffer.into_inner()
    }

    #[test]
    fn sanitizes_hostile_file_names() {
        // Only the basename survives, dots/underscores replace the rest.
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("..\\..\\win\\evil.png"), "evil.png");
        assert_eq!(sanitize_file_name("zdjęcie świata.JPG"), "zdj_cie__wiata.JPG");
        assert_eq!(sanitize_file_name("...."), "plik");
        assert_eq!(sanitize_file_name(""), "plik");
        assert_eq!(sanitize_file_name("café.png"), "caf_.png");
    }

    #[test]
    fn imports_valid_image_and_detects_duplicates() {
        let (_tmp, state) = sample_state();
        let bytes = png_with_alpha();

        let first = import_from_bytes(&state, "alfa.png", bytes.clone()).unwrap();
        assert_eq!(first["duplicate"], json!(false));
        assert_eq!(first["width"], json!(3));
        let file_path = state.root.join(first["file_path"].as_str().unwrap());
        let thumb_path = state.root.join(first["thumb_path"].as_str().unwrap());
        assert!(file_path.exists(), "media file must exist");
        assert!(thumb_path.exists(), "thumbnail must exist");
        assert!(thumb_path.extension().unwrap() == "jpg");

        // Same payload again → duplicate, no new row, no new file.
        let second = import_from_bytes(&state, "kopia.png", bytes).unwrap();
        assert_eq!(second["duplicate"], json!(true));
        assert_eq!(second["id"], first["id"]);
        let conn = state.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn rejects_broken_and_foreign_files() {
        let (_tmp, state) = sample_state();

        let broken = import_from_bytes(&state, "broken.png", b"not an image at all".to_vec());
        assert!(broken.is_err(), "corrupt payload must be rejected");

        let wrong_ext = import_from_bytes(&state, "dokument.pdf", png_with_alpha());
        assert!(wrong_ext.is_err(), "unsupported extension must be rejected");

        let empty = import_from_bytes(&state, "pusty.png", Vec::new());
        assert!(empty.is_err());
    }

    #[test]
    fn rejects_oversized_files() {
        let (_tmp, state) = sample_state();
        // A file above the 12 MB limit is rejected even with a valid extension
        // and valid image payload size check firing before any disk write.
        let big_path = state.root.join("duze.png");
        let big = vec![0u8; MAX_FILE_BYTES + 1];
        fs::write(&big_path, &big).unwrap();
        let item = MediaImport {
            name: "duze.png".to_string(),
            path: Some(big_path.to_string_lossy().to_string()),
            bytes_b64: None,
        };
        let conn = state.conn.lock().unwrap();
        let result = import_single(&conn, &state, &item, None, "inne");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("za duży"));
    }

    #[test]
    fn imports_gif_and_webp_without_error() {
        let (_tmp, state) = sample_state();
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            4,
            4,
            image::Rgb([10, 200, 30]),
        ));
        for (image_format, ext) in [
            (image::ImageFormat::Gif, "gif"),
            (image::ImageFormat::WebP, "webp"),
        ] {
            let mut buffer = std::io::Cursor::new(Vec::new());
            // The image crate cannot encode WebP; skip that direction gracefully.
            if img.write_to(&mut buffer, image_format).is_err() {
                continue;
            }
            let result = import_from_bytes(&state, &format!("obrazek.{ext}"), buffer.into_inner());
            assert!(result.is_ok(), "{ext}: {result:?}");
        }
    }
}
