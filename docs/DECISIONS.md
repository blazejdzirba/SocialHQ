# DECISIONS — SocialHQ

Decyzje podjęte podczas doprowadzania projektu do działającej aplikacji.
Numeracja usterkek odpowiada specyfikacji (A–P).

## Kluczowe decyzje techniczne

1. **Schowek (I):** jeden długotrwający obiekt `arboard::Clipboard` w `AppState`
   zamiast tworzenia przy każdej komendzie — na X11 zawartość schowka ginie
   razem z obiektem; bez menedżera schowka krótkotrwałe `Clipboard` gubi treść.
   Dla tekstu główną ścieżką jest `navigator.clipboard` (działa na X11 i
   Waylandzie), IPC jest fallbackiem. Nie dodano `tauri-plugin-clipboard-manager`
   (nowa zależność nie była konieczna). Funkcja `wayland-data-control` w
   `arboard` nie została włączona — docelowo warto rozważyć.
2. **`db_exec` (L):** usunięty całkowicie. Zastąpiony dwiema wąskimi komendami:
   `db_set_links` (transakcyjne DELETE+INSERT OR IGNORE na join-tabelach) i
   `db_set_setting` (upsert po `key`). Zero dowolnego SQL z frontendu.
   Kolumny walidowane względem `PRAGMA table_info` z cache w `AppState`;
   identyfikatory muszą pasować do `^[a-z_][a-z0-9_]*$`.
3. **Snapshoty bazy (J/K):** `VACUUM INTO` do pliku tymczasowego → zip.
   Bezpieczne przy otwartym połączeniu i trybie WAL (kopia żywego pliku nie
   jest spójna). Nie użyto `rusqlite::backup` — VACUUM INTO jest prostsze i
   wystarcza dla małej, lokalnej bazy.
4. **Import archiwum (J):** pełna walidacja przed nadpisaniem: dozwolone
   prefiksy (`db/`, `media/`, `thumbs/`), odrzucenie `..`/ścieżek absolutnych,
   baza musi się otworzyć i zmigrować na kopii tymczasowej. Backup przed
   importem + rollback (plik `.pre-import` + zamiana połączenia na in-memory
   na czas podmiany). Stare `-wal`/`-shm` z archiwum są ignorowane.
5. **Zakres backupów:** automatyczne kopie (start/zamknięcie/ręczne) obejmują
   **samą bazę**; zdjęcia są plikami na dysku w katalogu danych. Pełny,
   przenośny zestaw (baza + media + thumbs) to **eksport ZIP**, który robi
   spójny snapshot i zawiera manifest. Rotacja: 5 najnowszych (nazwa pliku
   zawiera stempel czasu, sortowanie leksykograficzne = chronologiczne;
   unikalny sufiks przy kolizji w tej samej sekundzie).
6. **Drag & drop (F):** natywne `getCurrentWebview().onDragDropEvent` dla
   backendu Tauri (ścieżki → `import_media`), HTML5 `dataTransfer` zostawiony
   wyłącznie dla trybu przeglądarki. `dragDropEnabled: true` jawne w konfiguracji.
7. **Wklejanie obrazów (G):** nowa komenda `read_clipboard_image` (arboard →
   PNG/base64) zamiast polegania na `clipboardData.files`, którego WebKitGTK
   nie zawsze dostarcza. UI czyta schowek przez IPC przy `Ctrl+V` poza polami
   tekstowymi.
8. **Miniatury (H):** spłaszczenie do RGB8 (`DynamicImage::to_rgb8`) przed
   `save_with_format(Jpeg)` — poprawka na PNG z alfą i GIF; testowane.
9. **CSP (M):** restrykcyjne, z `script-src 'self' 'unsafe-inline'` — bundle
   Vite (`vite-plugin-singlefile`) wstrzykuje inline skrypt do `index.html`;
   zdjęcie tej reguły wymagałoby zmiany builda (nie robimy tego w tej iteracji
   — CSP i tak blokuje wszystko poza `self`/`asset:`/`ipc:`).
10. **Ikony (C):** wygenerowane `npx tauri icon` z `public/socialhq-icon.png`
    (1254×1254). Zestaw mobilny (android/ios) pozostawiony — nie przeszkadza
    w buildach desktopowych.
11. **Env. testowe:** testy Rust używają `tempfile::tempdir` — nigdy nie dotykają
    `~/.local/share/pl.socialhq.desktop/`. Nie wprowadzono nadpisywalnej ścieżki
    danych (nie była potrzebna). Dane użytkownika nie były modyfikowane.
12. **Nowe zależności:** brak nowych crate'ów/npm poza tymi w projekcie
    (`rustup component add clippy` to narzędzie, nie zależność aplikacji).
13. **Git:** repo nie było inicjalizowane w sandboxie (brak wymagania w
    deliverable); `.gitignore` zostawiony do dodania przy pierwszym `git init`
    na maszynie docelowej (node_modules, dist, src-tauri/target, src-tauri/gen).

## Ograniczenia środowiska (do rutyny na maszynie docelowej)

- Sandbox wykonawczy miał 2 GB RAM bez swapu: `vite build` (minifikacja) był
  zabijany przez OOM. Na Pop!_OS 22.04+ z ≥4 GB RAM `npm run tauri build`
  powinno przejść bez zmian w kodzie.
- Nie można uruchomić okna GUI (brak X/Wayland) — smoke test startu i pełny
  `tauri build --bundles deb,appimage` do potwierdzenia przez użytkownika
  (lista kroków w raporcie końcowym).
