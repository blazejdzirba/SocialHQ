/**
 * Tiny IndexedDB wrapper used by the browser fallback backend to persist
 * image blobs (originals and thumbnails) outside of the metadata tables.
 */
const DB_NAME = "socialhq-media";
const STORE_NAME = "blobs";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Brak IndexedDB w tej przeglądarce."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Nie udało się otworzyć bazy mediów."));
    });
  }
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Operacja na mediach nie powiodła się."));
      }),
  );
}

export function idbPut(key: string, blob: Blob): Promise<void> {
  return run("readwrite", (store) => store.put(blob, key) as IDBRequest<IDBValidKey>).then(
    () => undefined,
  );
}

export function idbGet(key: string): Promise<Blob | undefined> {
  return run("readonly", (store) => store.get(key) as IDBRequest<Blob | undefined>);
}

export function idbDelete(key: string): Promise<void> {
  return run("readwrite", (store) => store.delete(key) as unknown as IDBRequest<undefined>).then(
    () => undefined,
  );
}

export function idbKeys(): Promise<string[]> {
  return run("readonly", (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>).then((keys) =>
    keys.map((key) => String(key)),
  );
}
