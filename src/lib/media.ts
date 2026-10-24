import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { idbGet } from "./idb";
import type { DataApi } from "./store";

const objectUrlCache = new Map<string, string>();
let rootPromise: Promise<string> | null = null;

/** Resolves a stored (relative) media path into a URL the UI can render. */
export async function resolveMediaUrl(api: DataApi, path: string): Promise<string> {
  if (!path) return "";

  if (path.startsWith("idb:")) {
    const key = path.slice(4);
    const cached = objectUrlCache.get(key);
    if (cached) return cached;
    const blob = await idbGet(key);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(key, url);
    return url;
  }

  if (api.backend === "tauri") {
    if (!rootPromise) {
      rootPromise = api.dataPaths().then((paths) => paths.root);
    }
    const root = await rootPromise;
    return convertFileSrc(`${root}/${path}`);
  }

  return "";
}

/** React hook returning a displayable URL for a media path. */
export function useMediaUrl(api: DataApi | null, path: string): string {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!api || !path) {
      setUrl("");
      return undefined;
    }
    void resolveMediaUrl(api, path).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [api, path]);

  return url;
}
