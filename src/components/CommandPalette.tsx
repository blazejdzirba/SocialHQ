import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import { useApp } from "@/state/AppContext";
import { Icon, type IconName } from "./icons";
import { KeyboardHint } from "./ui";
import { truncate } from "@/lib/format";
import type { SearchHit } from "@/types";

const TYPE_META: Record<SearchHit["entity_type"], { label: string; icon: IconName }> = {
  post: { label: "Pomysł", icon: "idea" },
  group: { label: "Grupa", icon: "group" },
  prompt: { label: "Prompt", icon: "wand" },
  media: { label: "Zdjęcie", icon: "image" },
};

export function CommandPalette() {
  const { api, workspace, paletteOpen, setPaletteOpen, setSection, setSelectedGroupId } = useApp();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!paletteOpen) {
      setQuery("");
      setHits([]);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen || !api) return;
    let cancelled = false;
    const needle = query.trim();
    const timer = window.setTimeout(async () => {
      if (!needle) {
        setHits([]);
        return;
      }
      try {
        const results = await api.search(needle);
        if (!cancelled) {
          setHits(results);
          setCursor(0);
        }
      } catch {
        if (!cancelled) setHits([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, paletteOpen, api]);

  const localHits = useMemo<SearchHit[]>(() => {
    if (query.trim()) return hits;
    const recent = workspace.posts.slice(0, 5).map((post) => ({
      entity_type: "post" as const,
      entity_id: post.id,
      title: post.title || "Bez tytułu",
      snippet: truncate(post.body, 70),
    }));
    const groups = workspace.groups.slice(0, 4).map((group) => ({
      entity_type: "group" as const,
      entity_id: group.id,
      title: group.name,
      snippet: group.topic ?? "Grupa",
    }));
    return [...recent, ...groups];
  }, [hits, query, workspace.posts, workspace.groups]);

  const open = (hit: SearchHit) => {
    if (hit.entity_type === "post") setSection("posts");
    if (hit.entity_type === "group") {
      setSection("groups");
      setSelectedGroupId(hit.entity_id);
    }
    if (hit.entity_type === "prompt") setSection("prompts");
    if (hit.entity_type === "media") setSection("media");
    setPaletteOpen(false);
  };

  useEffect(() => {
    if (!paletteOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPaletteOpen(false);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((value) => Math.min(value + 1, localHits.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((value) => Math.max(value - 1, 0));
      }
      if (event.key === "Enter" && localHits[cursor]) {
        event.preventDefault();
        open(localHits[cursor]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!paletteOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-start justify-center p-4 sm:p-12">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-[3px]"
        onClick={() => setPaletteOpen(false)}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-[18px] border border-white/10 bg-[#0d1211] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <Icon name="search" size={17} className="text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj pomysłów, grup, promptów i zdjęć…"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            aria-label="Wyszukiwarka globalna"
          />
          <KeyboardHint keys={["Esc"]} />
        </div>

        <div className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
          {localHits.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12.5px] text-faint">
              {query ? "Brak wyników." : "Zacznij pisać, żeby przeszukać wszystkie sekcje."}
            </p>
          ) : (
            localHits.map((hit, index) => {
              const meta = TYPE_META[hit.entity_type];
              return (
                <button
                  key={`${hit.entity_type}-${hit.entity_id}`}
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => open(hit)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    index === cursor ? "bg-accent/12" : "hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      index === cursor
                        ? "bg-accent/20 text-accent"
                        : "bg-white/[0.06] text-faint",
                    )}
                  >
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-fg">{hit.title}</span>
                      <span className="caps text-faint">{meta.label}</span>
                    </span>
                    <span className="block truncate text-[11.5px] text-faint">{hit.snippet}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-faint">
          <span>↑↓ nawigacja · Enter otwórz</span>
          <span>Szukamy w pomysłach, grupach, promptach i zdjęciach</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
