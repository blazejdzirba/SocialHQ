# PROGRESS — SocialHQ

Log prac porządkujących (2026-10-24). Format: co zrobione + jak zweryfikowano.

## Faza 0 — środowisko

- Zainstalowano Node 22, Rust 1.99 (rustup stable), biblioteki systemowe
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`,
  `libayatana-appindicator3-dev`, `libxdo-dev`, `libssl-dev`, `patchelf`,
  `libfuse2`, `xvfb`). `pkg-config --modversion webkit2gtk-4.1 gtk+-3.0` → 2.52.6 / 3.24.41.
- Bazowy stan: `npx tsc --noEmit` OK, `npx vitest run` 24/24 OK.

## Faza 1 — kompilacja i start

- **A** naprawione: 4× `format(` → `format!(` (`db_insert`, `db_update`, `db_delete`, `copy_text`).
- **B** naprawione: `extension_of` używa `to_string_lossy()`.
- **C** naprawione: `npx tauri icon public/socialhq-icon.png` wygenerował pełny zestaw
  (32x32, 128x128, 128x128@2x, icon.png, ico/icns, Store/Square logo, mobilne).
- **D** naprawione: usunięto `asset:default` z `capabilities/default.json`
  (protokół asset konfigurowany jest w `tauri.conf.json`; permission nie istnieje).
- **E** naprawione: `package.json` → name `socialhq`, version `0.1.0`, skrypty
  `tauri`, `typecheck`, `test`.
- **O** naprawione: usunięte nieaktualne twierdzenie o PPA (WebKitGTK 4.1 jest w
  standardowych repo Pop!_OS 22.04+); `base64::encode` → `Engine::encode`;
  README przepisany.
- Weryfikacja: `cargo check` ✅, `cargo clippy -- -D warnings` ✅ (0 ostrzeżeń),
  `cargo test` 20/20 ✅, `npx tsc --noEmit` ✅, `npx vitest run` 24/24 ✅.

## Faza 2 — funkcje runtime

- **F** naprawione: `MediaView.tsx` subskrybuje `getCurrentWebview().onDragDropEvent`
  (enter/over/leave/drop → `importMedia({ paths })`); wskaźnik „upuść tutaj”
  sterowany zdarzeniami natywnymi; HTML5 onDrop zostawiony tylko dla trybu
  przeglądarki. `dragDropEnabled: true` jawnie ustawione w konfiguracji okna.
- **G** naprawione: nowa komenda `read_clipboard_image` (arboard `get_image` → PNG
  base64) + `DataApi.readClipboardImage()`; `Ctrl+V` w bibliotece zdjęć czyta
  obraz przez Rust, gdy WebKitGTK nie wystawia plików w `ClipboardEvent`
  (pola tekstowe wyłączone z przechwycenia).
- **H** naprawione: miniatura jest spłaszczana do RGB8 (`to_rgb8`) przed zapisem
  JPEG — PNG z alfą, GIF i WebP przechodzą (test jednostkowy na PNG z alfą).
- **N** naprawione: limit 12 MB/plik (`MAX_FILE_BYTES`) + decode `image` jako
  prawdziwa bramka zawartości (rozszerzenie nie wystarcza); testy na plik
  uszkodzony i przewymiarowany.
- **I** naprawione: długotrwający `arboard::Clipboard` w `AppState` (X11/Wayland):
  `copy_text`, `copy_media` i `read_clipboard_image` korzystają z jednego obiektu;
  `storeTauri.copyText` preferuje `navigator.clipboard` z fallbackiem na IPC.
- Weryfikacja: testy `imports_valid_image_and_detects_duplicates`,
  `imports_gif_and_webp_without_error`, `rejects_broken_and_foreign_files`,
  `rejects_oversized_files`, `sanitizes_hostile_file_names` — wszystkie zielone.

## Faza 3 — utwardzenie

- **J** naprawione: `import_archive` rozpakowuje do pamięci, waliduje (prefiksy
  `db/`,`media/`,`thumbs/`, zip-slip `..`/absolutne, brak sidecarów `-wal/-shm`,
  otwieralność bazy przez `db::open`+`migrate`), robi backup przed, podmienia
  pliki z rollbackiem, po imporcie otwiera bazę na nowo; `SettingsView` wywołuje
  `refresh()` po imporcie. Testy: poprawny import, złośliwy `../`, uszkodzony zip.
- **K** naprawione: eksport otwiera okno zapisu (`@tauri-apps/plugin-dialog`
  `save`, domyślna nazwa `socialhq-export-RRRR-MM-DD.zip`); snapshot bazy przez
  `VACUUM INTO` zamiast kopiowania żywego pliku z WAL.
- **L** naprawione: biała lista kolumn z `PRAGMA table_info` (cache w `AppState`),
  walidacja `^[a-z_][a-z0-9_]*$`; `db_exec` usunięte — zastąpione
  `db_set_links` (DELETE+INSERT w jednej transakcji) i `db_set_setting`
  (upsert po `key`); `storeTauri.setLinks` używa jednego wywołania IPC.
- **M** naprawione: restrykcyjne CSP w `tauri.conf.json`
  (`default-src 'self'`; img `asset:`/`http://asset.localhost`/`data:`/`blob:`;
  connect `ipc:`/`http://ipc.localhost`), scope asset `$APPDATA/**`;
  wyświetlanie przez `convertFileSrc` bez zmian.
- **Backupy**: przy starcie i `CloseRequested`, `VACUUM INTO`, rotacja do 5
  (posortowane po nazwie ze stemplem czasu), unikalne nazwy przy dwóch
  backupach w tej samej sekundzie, błędy logowane do `logs/socialhq.log`.
  Backup obejmuje samą bazę (decyzja w DECISIONS.md).
- **Przywracanie z backupu**: komenda `restore_backup` (tylko pliki z
  `backups/`) + UI w Ustawieniach (lista, przycisk „Przywróć”, potwierdzenie).
- Brak `unwrap()` na mutexach/ścieżkach: `lock_conn`, `with_clipboard` itd.
  zwracają polskie komunikaty błędów.

## Faza 4 — testy

- Rust 20/20 (`cargo test`): migracje (split, apply, idempotencja, FK, katalogi),
  walidacja identyfikatorów i kolumn, `set_links` transakcyjnie, `set_setting`
  upsert, sanityzacja nazw, import zdjęć (poprawny/duplikat/uszkodzony/zły
  format/za duży/GIF+WebP/PNG-alfa), rotacja backupów, spójność backupu
  (otwarcie zip i odczyt bazy), import archiwum (poprawny/złośliwy/uszkodzony),
  restore backupu, FTS sanitizacja.
- Frontend 24/24 (`npx vitest run`) — nietknięte, w tym smoke test renderu.
- Testowalne bez Tauri: logika komend wydzielona do `*_inner(&AppState, …)`.

## Faza 5 — build paczek

- `cargo check`/`clippy -D warnings`/`test`/`cargo build` (binarny debug) — OK.
- `npm run build` (Vite) kończy się `Killed`: sandbox dostarcza 2 GB RAM bez
  możliwości swapu (`swapon` zabroniony) i build zostaje ubity przez OOM.
  Ten sam pipeline (`vite build` w `beforeBuildCommand`) działa na desktopie
  z ≥4 GB RAM; ograniczenie jest środowiskowe, nie kodowe.
  `npx tauri build --bundles deb,appimage` do uruchomienia na maszynie docelowej.

## Faza 6 — dokumentacja

- README przepisany (zależności bez PPA, dev, testy, build, dane, backupy,
  przywracanie, ograniczenia), `docs/DECISIONS.md` i `docs/PROGRESS.md` dodane.

## Dodatkowe znalezione i naprawione błędy (poza listą A–P)

1. `db::open` robił `execute_batch("PRAGMA journal_mode = WAL; …")` — PRAGMA
   zwracająca wiersz wywala `execute_batch` („Execute returned results”),
   co **uniemożliwiałoby start aplikacji**. Naprawione (`query_row`/`pragma_update`).
2. `settings` nie dało się zapisać z frontendu (tabela bez kolumny `id`, biała
   lista klucza primary w `db_update` zwracałaby błąd) → `db_set_setting` upsert.
3. `seed.ts`: pętla `forEach` z nieoczekiwanym `api.insert(...)` — szablony
   mogły nie trafić do bazy przed pierwszym renderem → `await` w pętli.
4. Kopie zapasowe w tej samej sekundzie nadpisywały się (nazwa tylko ze
   stemplem sekundowym) → unikalny sufiks.
5. `export_media` pisał do `exports/` nazwy plików wprost z bazy → sanityzacja.
6. `open_external` mógł dostać pusty URL / zaczynający się od `-` (inicjowanie
   flag) → walidacja.
7. `archive.rs` checkpoint przez `execute_batch` → `query_row` (to samo
   ograniczenie PRAGMA co wyżej), także w `validate_database_file`.
