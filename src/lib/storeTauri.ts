import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { BackupEntry, DataPaths, SearchHit } from "@/types";
import type { DataApi, MediaImportResult, MediaSources, Row } from "./store";
import { toBase64 } from "./store";

/**
 * Desktop backend: every operation is forwarded to the Rust core where the
 * SQLite database, the media folder and the archives live.
 */
export function createTauriApi(): DataApi {
  const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    invoke<T>(command, args);

  return {
    backend: "tauri",

    async init() {
      // Migrations run during the Rust setup hook; nothing to do here.
    },

    all: <T = Row>(table: string) => call<T[]>("db_all", { table }),

    insert: <T = Row>(table: string, row: Row) =>
      call<T>("db_insert", { table, row }),

    update: <T = Row>(table: string, id: number, patch: Row) =>
      call<T>("db_update", { table, id, patch }),

    remove: (table: string, id: number) => call<void>("db_delete", { table, id }),

    // Atomic on the Rust side: delete + reinsert runs in one transaction.
    setLinks(table, ownerColumn, ownerId, linkedColumn, linkedIds) {
      return call<void>("db_set_links", {
        table,
        ownerColumn,
        ownerId,
        linkedColumn,
        linkedIds,
      });
    },

    setSetting(key: string, value: string) {
      return call<void>("db_set_setting", { key, value });
    },

    search: (query: string) => call<SearchHit[]>("db_search", { query }),

    openExternal: (url: string) => call<void>("open_external", { url }),

    // navigator.clipboard is the primary path (works on X11 and Wayland and
    // keeps content alive); the Rust command is the fallback.
    async copyText(text: string) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        await call("copy_text", { text });
      }
    },

    copyImage: (id: number) => call<void>("copy_media", { id }),

    showInFolder: (id: number) => call<void>("show_in_folder", { id }),

    exportMedia: (id: number) => call<string>("export_media", { id }),

    async pickMediaFiles(): Promise<MediaSources> {
      const selection = await openDialog({
        multiple: true,
        filters: [{ name: "Zdjęcia", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
      });
      if (!selection) return { paths: [] };
      const paths = Array.isArray(selection) ? selection : [selection];
      return { paths };
    },

    async pickArchive(): Promise<File | string | null> {
      const selection = await openDialog({
        multiple: false,
        filters: [{ name: "Archiwum SocialHQ", extensions: ["zip"] }],
      });
      if (!selection) return null;
      return Array.isArray(selection) ? (selection[0] ?? null) : selection;
    },

    async importMedia(sources, options): Promise<MediaImportResult[]> {
      const items: { name: string; path?: string; bytes_b64?: string }[] = [];
      for (const path of sources.paths ?? []) {
        const name = path.split("/").pop() ?? path;
        items.push({ name, path });
      }
      for (const file of sources.files ?? []) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        items.push({ name: file.name, bytes_b64: toBase64(bytes) });
      }
      if (items.length === 0) return [];
      const rows = await call<Row[]>("import_media", {
        items,
        projectId: options.projectId,
        category: options.category,
      });
      return rows.map((row) => ({ row, duplicate: Boolean(row.duplicate) }));
    },

    // Opens a system save dialog with a dated default name; the chosen path is
    // passed to the Rust core (falls back to exports/ when cancelled).
    async exportArchive(): Promise<string> {
      let destination: string | null = null;
      try {
        destination = await saveDialog({
          defaultPath: `socialhq-export-${new Date().toISOString().slice(0, 10)}.zip`,
          filters: [{ name: "Archiwum SocialHQ", extensions: ["zip"] }],
        });
      } catch {
        destination = null;
      }
      return call<string>("export_archive", { destination: destination ?? null });
    },

    async importArchive(source: File | string) {
      if (typeof source === "string") {
        await call("import_archive", { path: source });
        return;
      }
      const bytes = new Uint8Array(await source.arrayBuffer());
      await call("import_archive", { path: "", bytes_b64: toBase64(bytes) });
    },

    createBackup: () => call<string>("create_backup", { silent: true }),

    listBackups: () => call<BackupEntry[]>("list_backups"),

    restoreBackup: (path: string) => call<void>("restore_backup", { path }),

    dataPaths: () => call<DataPaths>("data_paths"),

    openDataFolder: () => call<void>("open_data_folder"),
  };
}
