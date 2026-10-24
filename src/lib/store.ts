import type { BackupEntry, DataPaths, SearchHit } from "@/types";
import { createBrowserApi } from "./storeBrowser";
import { createTauriApi } from "./storeTauri";

export type Row = Record<string, unknown>;

export interface MediaSources {
  /** Absolute paths (desktop backend). */
  paths?: string[];
  /** File objects (browser fallback / drag & drop / paste). */
  files?: File[];
}

export interface MediaImportResult {
  row: Row;
  duplicate: boolean;
}

export interface MediaImportOptions {
  projectId: number | null;
  category: string;
}

/**
 * Backend agnostic data access layer.
 * `tauri` talks to the Rust/SQLite core, `browser` is a local fallback that
 * keeps everything in localStorage + IndexedDB (used for previews).
 */
export interface DataApi {
  backend: "tauri" | "browser";
  init(): Promise<void>;
  all<T = Row>(table: string): Promise<T[]>;
  insert<T = Row>(table: string, row: Row): Promise<T>;
  update<T = Row>(table: string, id: number, patch: Row): Promise<T>;
  remove(table: string, id: number): Promise<void>;
  setLinks(
    table: string,
    ownerColumn: string,
    ownerId: number,
    linkedColumn: string,
    linkedIds: number[],
  ): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  /** Upserts one settings row (keyed by `key`). */
  setSetting(key: string, value: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  copyImage(id: number): Promise<void>;
  showInFolder(id: number): Promise<void>;
  exportMedia(id: number): Promise<string>;
  pickMediaFiles(): Promise<MediaSources>;
  pickArchive(): Promise<File | string | null>;
  importMedia(
    sources: MediaSources,
    options: MediaImportOptions,
  ): Promise<MediaImportResult[]>;
  exportArchive(): Promise<string>;
  importArchive(source: File | string): Promise<void>;
  createBackup(): Promise<string>;
  listBackups(): Promise<BackupEntry[]>;
  /** Restores a database backup from the app's backups directory (desktop). */
  restoreBackup?(path: string): Promise<void>;
  /** Reads an image from the system clipboard (desktop only). */
  readClipboardImage?(): Promise<{ data_base64: string; width: number; height: number } | null>;
  dataPaths(): Promise<DataPaths>;
  openDataFolder(): Promise<void>;
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function createDataApi(): DataApi {
  if (isTauriRuntime()) {
    return createTauriApi();
  }
  return createBrowserApi();
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
