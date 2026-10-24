import type { BackupEntry, DataPaths, SearchHit } from "@/types";
import { idbDelete, idbGet, idbKeys, idbPut } from "./idb";
import { createZip, readZip } from "./zip";
import type { DataApi, MediaImportResult, MediaSources, Row } from "./store";

const TABLE_KEY = "socialhq.tables.v1";
const BACKUP_KEY = "socialhq.backups.v1";
const ALLOWED = ["jpg", "jpeg", "png", "webp", "gif"];

type Tables = Record<string, Row[]>;

function readTables(): Tables {
  try {
    const raw = localStorage.getItem(TABLE_KEY);
    return raw ? (JSON.parse(raw) as Tables) : {};
  } catch {
    return {};
  }
}

function writeTables(tables: Tables): void {
  try {
    localStorage.setItem(TABLE_KEY, JSON.stringify(tables));
  } catch (error) {
    throw new Error(
      `Nie udało się zapisać danych: ${error instanceof Error ? error.message : "brak miejsca"}`,
    );
  }
}

function primaryKey(table: string): string {
  return table === "project_briefs" ? "project_id" : "id";
}

function nextId(rows: Row[]): number {
  return rows.reduce((max, row) => {
    const id = typeof row.id === "number" ? row.id : 0;
    return Math.max(max, id);
  }, 0) + 1;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const bytes = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ bytes[i], 2246822519);
  }
  return `fb${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nie udało się odczytać obrazu."));
    };
    image.src = url;
  });
}

async function makeThumbnail(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await loadBitmap(file);
  const width = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const height = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, 520 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Brak obsługi canvas w tej przeglądarce.");
  context.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("Nie udało się wygenerować miniatury.");
  return { blob, width, height };
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Browser fallback backend. Keeps metadata in localStorage and image blobs in
 * IndexedDB. It mirrors the desktop behaviour closely enough to preview the
 * whole application in a normal browser window.
 */
export function createBrowserApi(): DataApi {
  const tables = readTables();

  const table = (name: string): Row[] => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };

  return {
    backend: "browser",

    async init() {
      writeTables(tables);
    },

    async all<T = Row>(name: string) {
      return table(name).map((row) => ({ ...row })) as T[];
    },

    async insert<T = Row>(name: string, row: Row) {
      const rows = table(name);
      const withId = { ...row };
      if (!("id" in withId)) withId.id = nextId(rows);
      rows.push(withId);
      writeTables(tables);
      return { ...withId } as T;
    },

    async update<T = Row>(name: string, id: number, patch: Row) {
      const rows = table(name);
      const key = primaryKey(name);
      const index = rows.findIndex((row) => row[key] === id);
      if (index < 0) throw new Error("Nie znaleziono rekordu.");
      rows[index] = { ...rows[index], ...patch };
      writeTables(tables);
      return { ...rows[index] } as T;
    },

    async remove(name: string, id: number) {
      const rows = table(name);
      const key = primaryKey(name);
      tables[name] = rows.filter((row) => row[key] !== id);
      writeTables(tables);
    },

    async setLinks(name, ownerColumn, ownerId, linkedColumn, linkedIds) {
      const rows = table(name);
      const kept = rows.filter((row) => row[ownerColumn] !== ownerId);
      linkedIds.forEach((linkedId) => {
        kept.push({ [ownerColumn]: ownerId, [linkedColumn]: linkedId });
      });
      tables[name] = kept;
      writeTables(tables);
    },

    async setSetting(key: string, value: string) {
      const rows = table("settings");
      const found = rows.find((row) => row.key === key);
      if (found) {
        found.value = value;
      } else {
        rows.push({ key, value });
      }
      writeTables(tables);
    },

    async search(query: string): Promise<SearchHit[]> {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const hits: SearchHit[] = [];
      const push = (entity_type: SearchHit["entity_type"], entity_id: number, title: string, body: string) => {
        const haystack = `${title} ${body}`.toLowerCase();
        if (haystack.includes(needle)) {
          hits.push({
            entity_type,
            entity_id,
            title,
            snippet: body.slice(0, 140).trim(),
          });
        }
      };
      table("posts").forEach((row) =>
        push("post", Number(row.id), String(row.title ?? ""), String(row.body ?? "")),
      );
      table("groups").forEach((row) =>
        push(
          "group",
          Number(row.id),
          String(row.name ?? ""),
          `${row.topic ?? ""} ${row.rules ?? ""} ${row.notes ?? ""}`,
        ),
      );
      table("prompts").forEach((row) =>
        push("prompt", Number(row.id), String(row.title ?? ""), String(row.body ?? "")),
      );
      table("media").forEach((row) =>
        push(
          "media",
          Number(row.id),
          String(row.file_name ?? ""),
          `${row.description ?? ""} ${row.category ?? ""}`,
        ),
      );
      return hits.slice(0, 40);
    },

    async openExternal(url: string) {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    async copyText(text: string) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    },

    async copyImage(id: number) {
      const blob = await idbGet(`media:${id}`);
      if (!blob) throw new Error("Nie znaleziono pliku zdjęcia.");
      if (!navigator.clipboard?.write) {
        throw new Error("Schowek nie obsługuje obrazów w tej przeglądarce.");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    },

    async showInFolder() {
      throw new Error("Pokaż w folderze działa tylko w aplikacji desktopowej.");
    },

    async exportMedia(id: number) {
      const row = table("media").find((item) => Number(item.id) === id);
      const blob = await idbGet(`media:${id}`);
      if (!row || !blob) throw new Error("Nie znaleziono pliku zdjęcia.");
      const name = String(row.file_name ?? "zdjecie");
      download(blob, name);
      return name;
    },

    async pickMediaFiles(): Promise<MediaSources> {
      const files = await pickFiles("image/jpeg,image/png,image/webp,image/gif", true);
      return { files };
    },

    async pickArchive(): Promise<File | string | null> {
      const files = await pickFiles("application/zip,.zip", false);
      return files[0] ?? null;
    },

    async importMedia(
      sources: MediaSources,
      options: { projectId: number | null; category: string },
    ): Promise<MediaImportResult[]> {
      const results: MediaImportResult[] = [];
      const files = sources.files ?? [];
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!ALLOWED.includes(extension)) {
          throw new Error(`Format „${extension || "?"}” nie jest obsługiwany.`);
        }
        const buffer = await file.arrayBuffer();
        const hash = await sha256Hex(buffer);
        const existing = table("media").find((row) => row.sha256 === hash);
        if (existing) {
          results.push({ row: { ...existing }, duplicate: true });
          continue;
        }
        const thumbnail = await makeThumbnail(file);
        const inserted = await this.insert("media", {
          project_id: options.projectId,
          category: options.category,
          file_name: file.name,
          file_path: "",
          thumb_path: "",
          sha256: hash,
          width: thumbnail.width,
          height: thumbnail.height,
          size_bytes: file.size,
          description: "",
          created_at: new Date().toISOString(),
        });
        const id = Number(inserted.id);
        await idbPut(`media:${id}`, new Blob([buffer], { type: file.type }));
        await idbPut(`thumb:${id}`, thumbnail.blob);
        const row = await this.update("media", id, {
          file_path: `idb:media:${id}`,
          thumb_path: `idb:thumb:${id}`,
        });
        results.push({ row, duplicate: false });
      }
      return results;
    },

    async exportArchive() {
      const entries: { name: string; data: Uint8Array }[] = [];
      const encoder = new TextEncoder();
      entries.push({
        name: "db/socialhq.json",
        data: encoder.encode(JSON.stringify(tables, null, 2)),
      });
      for (const row of table("media")) {
        const id = Number(row.id);
        const blob = await idbGet(`media:${id}`);
        if (!blob) continue;
        const buffer = new Uint8Array(await blob.arrayBuffer());
        entries.push({
          name: `media/${id}-${String(row.file_name ?? "plik")}`,
          data: buffer,
        });
      }
      entries.push({
        name: "manifest.json",
        data: encoder.encode(
          JSON.stringify({
            app: "SocialHQ",
            exported_at: new Date().toISOString(),
            media_count: table("media").length,
          }),
        ),
      });
      const blob = createZip(entries);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      download(blob, `socialhq-export-${stamp}.zip`);
      return `socialhq-export-${stamp}.zip`;
    },

    async importArchive(source: File | string) {
      const file = source instanceof File ? source : null;
      if (!file) throw new Error("Nieprawidłowe archiwum.");
      const entries = await readZip(file);
      const databaseEntry = entries.find((entry) => entry.name === "db/socialhq.json");
      if (!databaseEntry) throw new Error("Archiwum nie zawiera bazy danych.");
      const restored = JSON.parse(new TextDecoder().decode(databaseEntry.data)) as Tables;
      for (const key of Object.keys(tables)) delete tables[key];
      Object.assign(tables, restored);
      writeTables(tables);

      for (const key of await idbKeys()) {
        if (key.startsWith("media:") || key.startsWith("thumb:")) await idbDelete(key);
      }
      for (const entry of entries.filter((item) => item.name.startsWith("media/"))) {
        const id = Number(entry.name.split("/")[1]?.split("-")[0]);
        if (!Number.isFinite(id)) continue;
        await idbPut(`media:${id}`, new Blob([entry.data as BlobPart]));
        const original = table("media").find((row) => Number(row.id) === id);
        if (original) {
          const thumb = await makeThumbnail(new Blob([entry.data as BlobPart]));
          await idbPut(`thumb:${id}`, thumb.blob);
        }
      }
    },

    async createBackup() {
      const encoder = new TextEncoder();
      const blob = createZip([
        { name: "db/socialhq.json", data: encoder.encode(JSON.stringify(tables)) },
      ]);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const name = `socialhq-${stamp}.zip`;
      await idbPut(`backup:${name}`, blob);
      const index = readBackups();
      index.unshift({
        name,
        path: `IndexedDB://backups/${name}`,
        size: blob.size,
        created_at: new Date().toISOString(),
      });
      writeBackups(index.slice(0, 5));
      return name;
    },

    async listBackups(): Promise<BackupEntry[]> {
      return readBackups();
    },

    async dataPaths(): Promise<DataPaths> {
      return {
        root: "Przeglądarka (localStorage + IndexedDB)",
        database: "localStorage://socialhq.tables.v1",
        media: "IndexedDB://socialhq-media",
        backups: "IndexedDB://socialhq-media/backups",
        exports: "Pobieranie do folderu pobierania",
        backend: "browser",
      };
    },

    async openDataFolder() {
      throw new Error("Otwieranie folderu danych działa tylko w aplikacji desktopowej.");
    },
  };
}

function readBackups(): BackupEntry[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as BackupEntry[]) : [];
  } catch {
    return [];
  }
}

function writeBackups(entries: BackupEntry[]): void {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(entries));
}
