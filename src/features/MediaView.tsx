import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useApp } from "@/state/AppContext";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  TagInput,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useMediaUrl } from "@/lib/media";
import { deleteMedia, setTags, updateMedia } from "@/lib/repo";
import type { MediaSources } from "@/lib/store";
import { formatBytes, formatDate, truncate } from "@/lib/format";
import type { MediaItem } from "@/types";

const ALL_CATEGORIES = "wszystkie";

export function MediaView() {
  const { api, workspace, toast, refresh, newItemNonce, consumeNewItem, mediaCategories } = useApp();
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [scope, setScope] = useState<"projekt" | "globalne">("projekt");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const importSources = async (sources: MediaSources) => {
    if (!api) return;
    const count = (sources.files?.length ?? 0) + (sources.paths?.length ?? 0);
    if (count === 0) return;
    setUploading(true);
    try {
      const results = await api.importMedia(
        sources,
        { projectId: workspace.project?.id ?? null, category: "do-postow" },
      );
      await refresh();
      const duplicates = results.filter((result) => result.duplicate).length;
      const added = results.length - duplicates;
      toast(
        duplicates > 0
          ? `Dodano ${added} zdjęć, pominięto ${duplicates} duplikatów.`
          : `Dodano ${added} zdjęć.`,
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się wgrać zdjęć.", "error");
    } finally {
      setUploading(false);
    }
  };

  const importFiles = (files: File[]) => importSources({ files });

  useEffect(() => {
    if (consumeNewItem()) fileInput.current?.click();
  }, [newItemNonce, consumeNewItem]);

  // Paste from the system clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length > 0) {
        event.preventDefault();
        void importFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workspace.project?.id]);

  // System-wide drag & drop: in a Tauri window HTML5 file drop events never
  // arrive (dragDropEnabled), so we subscribe to the native event instead.
  useEffect(() => {
    if (!api || api.backend !== "tauri") return undefined;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragging(true);
          } else if (event.payload.type === "leave") {
            setDragging(false);
          } else if (event.payload.type === "drop") {
            setDragging(false);
            const paths = event.payload.paths;
            if (paths.length > 0) void importSources({ paths });
          }
        });
      } catch {
        /* older API version — the HTML5 fallback stays */
      }
    })();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workspace.project?.id]);

  // Paste images from the system clipboard (WebKitGTK often exposes no files
  // on ClipboardEvent, so we read the image through the Rust clipboard).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "v") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (!api?.readClipboardImage) return;
      event.preventDefault();
      void (async () => {
        try {
          const image = await api.readClipboardImage!();
          if (!image?.data_base64) return;
          const binary = atob(image.data_base64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }
          const file = new File([bytes], `schowek-${Date.now()}.png`, { type: "image/png" });
          void importFiles([file]);
        } catch {
          /* no image in the clipboard */
        }
      })();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workspace.project?.id]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.media.filter((item) => {
      if (category !== ALL_CATEGORIES && item.category !== category) return false;
      if (scope === "projekt" && item.project_id !== workspace.project?.id) return false;
      if (scope === "globalne" && item.project_id !== null) return false;
      if (!needle) return true;
      return (
        item.file_name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [workspace.media, category, scope, query, workspace.project?.id]);

  return (
    <div
      className="space-y-4"
      onDragOver={(event) => {
        if (api?.backend === "tauri") return; // native onDragDropEvent handles it
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (api?.backend === "tauri") return;
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        if (api?.backend === "tauri") return;
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length > 0) void importFiles(files);
      }}
    >
      <Card className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon="upload"
          onClick={() => fileInput.current?.click()}
          loading={uploading}
        >
          Wgraj zdjęcia
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            void importFiles(files);
            event.target.value = "";
          }}
        />
        <div className="relative min-w-[160px] flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj po nazwie, opisie lub tagu…"
            className="pl-9"
          />
        </div>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="w-[170px]"
          options={[
            { value: ALL_CATEGORIES, label: "Wszystkie kategorie" },
            ...mediaCategories.map((item) => ({ value: item, label: item })),
          ]}
        />
        <Select
          value={scope}
          onChange={(event) => setScope(event.target.value as "projekt" | "globalne")}
          className="w-[150px]"
          options={[
            { value: "projekt", label: "Projekt" },
            { value: "globalne", label: "Globalne" },
          ]}
        />
      </Card>

      {dragging ? (
        <div className="flex items-center justify-center rounded-[16px] border-2 border-dashed border-accent/50 bg-accent/[0.06] py-10 text-[13px] text-accent">
          <Icon name="upload" size={18} className="mr-2" /> Upuść zdjęcia, żeby je dodać
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon="image"
          title="Biblioteka jest pusta"
          description="Przeciągnij pliki, wklej je ze schowka (Ctrl+V) albo użyj przycisku wyżej. Duplikaty rozpoznajemy po SHA-256."
          action={
            <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()}>
              Wgraj zdjęcia
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              onOpen={() => setSelected(item)}
              onDelete={() => setConfirmDelete(item)}
            />
          ))}
        </div>
      )}

      <MediaDetail
        item={selected}
        onClose={() => setSelected(null)}
        onLightbox={() => {
          if (selected) setLightbox(selected);
        }}
        onChanged={refresh}
      />

      {lightbox ? <Lightbox item={lightbox} onClose={() => setLightbox(null)} /> : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Usunąć zdjęcie?"
        message="Wpis zniknie z biblioteki. Plik pozostanie w folderze danych aplikacji."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!api || !confirmDelete) return;
          await deleteMedia(api, confirmDelete.id);
          await refresh();
          setSelected(null);
          setConfirmDelete(null);
          toast("Zdjęcie usunięte.");
        }}
      />
    </div>
  );
}

function MediaTile({
  item,
  onOpen,
  onDelete,
}: {
  item: MediaItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { api } = useApp();
  const url = useMediaUrl(api, item.thumb_path);

  return (
    <article className="group overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.02] transition-colors hover:border-white/15">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-square w-full overflow-hidden bg-black/30"
      >
        {url ? (
          <img src={url} alt={item.file_name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon name="image" size={22} className="text-faint" />
          </div>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-muted">
          {item.width}×{item.height}
        </span>
      </button>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-fg">{truncate(item.file_name, 26)}</p>
          <p className="truncate text-[10.5px] text-faint">
            {formatBytes(item.size_bytes)} · {item.category}
          </p>
        </div>
        <IconButton icon="trash" label="Usuń" size="xs" onClick={onDelete} />
      </div>
    </article>
  );
}

function MediaDetail({
  item,
  onClose,
  onLightbox,
  onChanged,
}: {
  item: MediaItem | null;
  onClose: () => void;
  onLightbox: () => void;
  onChanged: () => Promise<void>;
}) {
  const { api, workspace, toast, mediaCategories } = useApp();
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTagsState] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string>("");

  useEffect(() => {
    if (!item) return;
    setCategory(item.category);
    setDescription(item.description);
    setTagsState(item.tags);
    setProjectId(item.project_id === null ? "" : String(item.project_id));
  }, [item]);

  const url = useMediaUrl(api, item?.thumb_path ?? "");
  const fullUrl = useMediaUrl(api, item?.file_path ?? "");

  const save = async () => {
    if (!api || !item) return;
    await updateMedia(api, item.id, {
      category,
      description,
      project_id: projectId ? Number(projectId) : null,
    });
    await setTags(api, "media_tags", "media_id", item.id, tags);
    await onChanged();
    toast("Zapisano zmiany.");
  };

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title={item?.file_name ?? "Zdjęcie"}
      description="Metadane, kategoria i tagi. Plik pozostaje w lokalnym folderze danych."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zamknij
          </Button>
          <Button variant="primary" icon="save" onClick={save}>
            Zapisz
          </Button>
        </>
      }
    >
      {item ? (
        <div className="grid gap-5 md:grid-cols-[280px_1fr]">
          <button
            type="button"
            onClick={onLightbox}
            className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/30"
          >
            {url ? (
              <img src={url} alt={item.file_name} className="h-full w-full object-cover" />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="flex items-center gap-1.5 text-[12px] text-fg">
                <Icon name="eye" size={15} /> Powiększ
              </span>
            </span>
          </button>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Meta label="Wymiary" value={`${item.width}×${item.height} px`} />
              <Meta label="Rozmiar" value={formatBytes(item.size_bytes)} />
              <Meta label="Dodano" value={formatDate(item.created_at)} />
              <Meta label="SHA-256" value={`${item.sha256.slice(0, 12)}…`} mono />
            </div>

            <Field label="Kategoria">
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                options={mediaCategories.map((entry) => ({ value: entry, label: entry }))}
              />
            </Field>

            <Field label="Przypisanie">
              <Select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                options={[
                  { value: "", label: "Globalne" },
                  ...workspace.projects.map((project) => ({
                    value: String(project.id),
                    label: project.name,
                  })),
                ]}
              />
            </Field>

            <Field label="Opis">
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Krótki opis zdjęcia…"
              />
            </Field>

            <Field label="Tagi">
              <TagInput value={tags} onChange={setTagsState} />
            </Field>

            <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
              <Button
                icon="copy"
                onClick={async () => {
                  if (!api) return;
                  try {
                    await api.copyImage(item.id);
                    toast("Obraz skopiowany do schowka.");
                  } catch (error) {
                    toast(
                      error instanceof Error
                        ? error.message
                        : "Nie udało się skopiować obrazu.",
                      "error",
                    );
                  }
                }}
              >
                Kopiuj obraz
              </Button>
              <Button
                icon="folder"
                onClick={async () => {
                  if (!api) return;
                  try {
                    await api.showInFolder(item.id);
                  } catch (error) {
                    toast(
                      error instanceof Error ? error.message : "Nie udało się otworzyć folderu.",
                      "error",
                    );
                  }
                }}
              >
                Pokaż w folderze
              </Button>
              <Button
                icon="download"
                onClick={async () => {
                  if (!api) return;
                  try {
                    const path = await api.exportMedia(item.id);
                    toast(`Skopiowano kopię: ${path}`);
                  } catch (error) {
                    toast(
                      error instanceof Error ? error.message : "Nie udało się wyeksportować.",
                      "error",
                    );
                  }
                }}
              >
                Eksport kopii
              </Button>
              {fullUrl ? (
                <a
                  href={fullUrl}
                  download={item.file_name}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[13px] text-fg transition-colors hover:bg-white/[0.08]"
                >
                  <Icon name="save" size={15} /> Pobierz
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2">
      <div className="caps text-faint">{label}</div>
      <div className={cn("mt-0.5 text-[12px] text-fg", mono && "mono")}>{value}</div>
    </div>
  );
}

function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { api } = useApp();
  const url = useMediaUrl(api, item.file_path);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={item.file_name}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-fg transition-colors hover:bg-white/[0.12]"
        aria-label="Zamknij podgląd"
      >
        <Icon name="close" size={16} />
      </button>
      {url ? (
        <img
          src={url}
          alt={item.file_name}
          className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-[12px] text-muted">
        {item.file_name} · {item.width}×{item.height} · {formatBytes(item.size_bytes)}
      </div>
    </div>
  );
}
