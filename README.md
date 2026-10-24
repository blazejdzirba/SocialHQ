# SocialHQ

**Lokalne centrum dowodzenia do prowadzenia mediów społecznościowych.**
Notatnik, planer i baza wiedzy dla fanpage'ów — brief, pomysły na posty, grupy,
biblioteka zdjęć i promptów. Aplikacja **niczego nie publikuje** i **nie łączy się
z żadnym API**: publikujesz ręcznie, SocialHQ tylko pamięta, planuje i porządkuje.

> Wszystko działa offline. Brak kont, chmury i telemetrii. Czcionka Inter
> dołączana lokalnie (bez CDN). Interfejs po polsku, ciemny motyw.

---

## Funkcje

- **Projekty (fanpage'e)** z 8-polowym briefem i wytycznymi wizualnymi; przełącznik w pasku bocznym.
- **Generator pakietu kontekstowego** — jeden przycisk kopiuje do schowka blok markdown z briefu + instrukcją (post na stronę / do grupy z zasadami i historią / grafika / 10 pomysłów / własne szablony). Skrót `Ctrl+Shift+C`.
- **Posty/pomysły** ze statusami Pomysł → Szkic → Gotowy → Opublikowany (kanban z drag & drop albo lista, filtry, tagi, powiązane zdjęcia).
- **Grupy na Facebooku**: URL, zasady, historia publikacji per grupa, ostrzeżenie o powtórce treści (Jaccard), szybkie dodawanie wielu grup z listy URL-i.
- **Biblioteka zdjęć**: import z dialogu, drag & drop z systemu (natywne zdarzenia Tauri), wklejanie `Ctrl+V` (również obrazów ze schowka systemowego przez Rust), kategorie, tagi, opisy, duplikaty po SHA-256, miniatury generowane w Rust, limit 12 MB/plik.
- **Biblioteka promptów** ze zmiennymi `{{nazwa}}` i `{{brief.*}}`, ulubione, tagi.
- **Wyszukiwarka globalna `Ctrl+K`** (FTS5 z diakrytykami + fallback LIKE).
- **Eksport/import ZIP** (okno zapisu systemowego, spójny snapshot bazy, walidacja archiwum przed nadpisaniem), **kopie zapasowe** przy starcie i zamknięciu (rotacja do 5) z **przywracaniem z poziomu Ustawień**.

---

## Wymagania (Pop!_OS 22.04+ / Ubuntu 22.04+)

- Node.js 18+ i npm
- Rust 1.77+ (`rustup`)
- Biblioteki systemowe:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  librsvg2-dev \
  libayatana-appindicator3-dev \
  libxdo-dev \
  libssl-dev \
  build-essential \
  curl wget file patchelf pkg-config
```

> **Uwaga:** na Pop!_OS 22.04+ pakiet `libwebkit2gtk-4.1-dev` jest w standardowych
> repozytoriach — **PPA webkitgtk nie jest potrzebne**.

Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

---

## Uruchomienie (dev)

```bash
npm install
npm run tauri dev      # natywne okno + Vite na porcie 1420
```

Pozostałe komendy:

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest run (24 testy)
npm run build          # produkcyjny build frontendu do dist/
cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo test
```

`npm run dev` (bez Tauri) otwiera tylko podgląd w przeglądarce na awaryjnym
backendzie localStorage + IndexedDB — do testów UI, nie do pracy.

---

## Build paczek: .deb i AppImage

```bash
npm run tauri build -- --bundles deb,appimage
```

Wynik:

```
src-tauri/target/release/bundle/deb/socialhq_0.1.0_amd64.deb
src-tauri/target/release/bundle/appimage/socialhq_0.1.0_amd64.AppImage
```

Instalacja `.deb`:

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/socialhq_0.1.0_amd64.deb
```

Uruchomienie AppImage:

```bash
chmod +x src-tauri/target/release/bundle/appimage/socialhq_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/socialhq_0.1.0_amd64.AppImage
```

Jeśli AppImage nie startuje, doinstaluj `libfuse2` (`sudo apt install libfuse2`).

---

## Gdzie leżą dane

```
~/.local/share/pl.socialhq.desktop/
├── db/socialhq.db     # baza SQLite (WAL, migracje przez PRAGMA user_version)
├── media/             # oryginalne zdjęcia (kopiowane, nie linkowane)
├── thumbs/            # miniatury JPEG (max 520 px) generowane w Rust
├── backups/           # ostatnie 5 kopii bazy (.zip, snapshot VACUUM INTO)
├── exports/           # eksporty .zip i kopie pojedynczych plików
└── logs/socialhq.log  # błędy backupów itp.
```

W bazie trzymamy wyłącznie metadane i ścieżki względne. Kopia zapasowa powstaje
automatycznie przy **starcie** i **zamknięciu** aplikacji oraz ręcznie
w Ustawieniach; obejmuje samą bazę (zdjęcia są osobnymi plikami na dysku —
pełny przenośny zestaw daje eksport ZIP).

---

## Skróty klawiszowe

| Skrót | Działanie |
| --- | --- |
| `Ctrl+K` | wyszukiwarka globalna |
| `Ctrl+N` | nowy element w bieżącej sekcji |
| `Ctrl+Shift+C` | kopiuj pakiet kontekstowy |
| `Ctrl+V` | wklej zdjęcie ze schowka (biblioteka zdjęć) |
| `Esc` | zamknij okno krokowe / podgląd |

---

## Struktura

```
src/            frontend (React + TS + Tailwind 4)
  lib/store.ts        interfejs DataApi (backend-agnostic)
  lib/storeTauri.ts   backend desktopowy (IPC → Rust/SQLite)
  lib/storeBrowser.ts awaryjny backend przeglądarkowy
  lib/repo.ts         operacje domenowe (CRUD, tagi, publikacje)
  lib/logic.ts        pakiet kontekstowy, Jaccard, zmienne promptów
  lib/seed.ts         dane startowe (projekt SoberBro)
  features/           BriefView, PostsView, GroupsView, MediaView, PromptsView, SettingsView
src-tauri/      rdzeń Rust (Tauri 2)
  src/lib.rs          komendy IPC (biała lista kolumn, transakcyjne set_links)
  src/db.rs           połączenie + migracje (PRAGMA user_version)
  src/media.rs        import zdjęć, SHA-256, miniatury, schowek (arboard)
  src/archive.rs      eksport/import ZIP, backupy (VACUUM INTO), przywracanie
  src/migrations.sql  schemat (4 migracje, FTS5 opcjonalne)
```

## Bezpieczeństwo warstwy danych

- tabela na białej liście po stronie Rust; **kolumny walidowane** względem `PRAGMA table_info` (cache), identyfikatory `^[a-z_][a-z0-9_]*$`;
- dawne `db_exec` (dowolny SQL z frontendu) zastąpione transakcyjnym `db_set_links` i upsertem `db_set_setting`;
- import archiwum: walidacja **przed** nadpisaniem (manifest, dozwolone prefiksy, otwieralność bazy, migracja), ochrona przed path traversal, wycofanie zmian przy błędzie, automatyczny backup przed importem;
- snapshoty baz przez `VACUUM INTO` (spójne, bezpieczne przy WAL), rotacja do 5 backupów;
- CSP: `default-src 'self'`, obrazy `asset:`/`data:`/`blob:`, IPC tylko `ipc:`/`http://ipc.localhost`.

## Testy

- frontend: 24 testy vitest (logika pakietu, Jaccard, zmienne, migracje, smoke test renderu),
- Rust: 20 testów `cargo test` (migracje i idempotencja, sanityzacja nazw plików, import zdjęć: poprawny/duplikat/uszkodzony/zły format/PNG z alfą/GIF, limit rozmiaru, rotacja backupów, spójność backupu, import archiwum: poprawny/złośliwy `../`/uszkodzony, przywracanie z backupu, walidacja kolumn, transakcyjne powiązania, FTS).

## Licencja

MIT. Kod i komentarze po angielsku, interfejs po polsku.
