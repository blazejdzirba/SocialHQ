import { useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { useApp } from "@/state/AppContext";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  SectionLabel,
  Select,
  StepHeader,
  TagInput,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useMediaUrl } from "@/lib/media";
import {
  createPost,
  deletePost,
  duplicatePost,
  publishPost,
  setTags as setPostTags,
  updatePost,
} from "@/lib/repo";
import { findSimilar } from "@/lib/logic";
import { formatDate, relativeTime, toDateInput, truncate } from "@/lib/format";
import { POST_KINDS, POST_STATUSES, type Post, type PostKind, type PostStatus } from "@/types";

const STATUS_TONE: Record<PostStatus, "neutral" | "accent" | "warn" | "info"> = {
  idea: "neutral",
  draft: "warn",
  ready: "accent",
  published: "info",
};

export function PostsView() {
  const { api, workspace, toast, refresh, newItemNonce, consumeNewItem } = useApp();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | PostKind>("all");
  const [groupFilter, setGroupFilter] = useState<"all" | number>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [view, setView] = useState<"board" | "list">("board");
  const [editing, setEditing] = useState<Post | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [publishing, setPublishing] = useState<Post | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Post | null>(null);

  useEffect(() => {
    if (consumeNewItem()) {
      setEditing(null);
      setEditorOpen(true);
    }
  }, [newItemNonce]);

  const allTags = useMemo(
    () => Array.from(new Set(workspace.posts.flatMap((post) => post.tags))).sort(),
    [workspace.posts],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.posts.filter((post) => {
      if (kind !== "all" && post.kind !== kind) return false;
      if (groupFilter !== "all" && post.group_id !== groupFilter) return false;
      if (tagFilter !== "all" && !post.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      return (
        post.title.toLowerCase().includes(needle) ||
        post.body.toLowerCase().includes(needle) ||
        post.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [workspace.posts, query, kind, groupFilter, tagFilter]);

  const copyBody = async (post: Post) => {
    if (!api) return;
    await api.copyText(post.body);
    toast("Treść skopiowana do schowka.");
  };

  const moveStatus = async (postId: number, status: PostStatus) => {
    if (!api) return;
    const post = workspace.posts.find((item) => item.id === postId);
    if (!post || post.status === status) return;
    await updatePost(api, post.id, { status });
    await refresh();
    toast(`Przeniesiono do „${POST_STATUSES.find((item) => item.id === status)?.label}”.`);
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj w tytułach, treści i tagach…"
            className="pl-9"
          />
        </div>
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as "all" | PostKind)}
          className="w-[150px]"
          options={[
            { value: "all", label: "Wszystkie typy" },
            ...POST_KINDS.map((item) => ({ value: item.id, label: item.label })),
          ]}
        />
        <Select
          value={String(groupFilter)}
          onChange={(event) =>
            setGroupFilter(event.target.value === "all" ? "all" : Number(event.target.value))
          }
          className="w-[170px]"
          options={[
            { value: "all", label: "Wszystkie grupy" },
            ...workspace.groups.map((group) => ({ value: String(group.id), label: group.name })),
          ]}
        />
        <Select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="w-[140px]"
          options={[
            { value: "all", label: "Wszystkie tagi" },
            ...allTags.map((tag) => ({ value: tag, label: `#${tag}` })),
          ]}
        />
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          <IconButton
            icon="grid"
            label="Widok tablicy"
            size="xs"
            variant={view === "board" ? "outline" : "ghost"}
            onClick={() => setView("board")}
          />
          <IconButton
            icon="list"
            label="Widok listy"
            size="xs"
            variant={view === "list" ? "outline" : "ghost"}
            onClick={() => setView("list")}
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="idea"
          title={workspace.posts.length === 0 ? "Zaczynamy od pomysłu" : "Brak wyników"}
          description={
            workspace.posts.length === 0
              ? "Zapisuj pomysły na posty, przesuń je między statusami i kopiuj gotową treść."
              : "Zmień filtry albo wyczyść wyszukiwanie, żeby zobaczyć więcej."
          }
          action={
            workspace.posts.length === 0 ? (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                Nowy pomysł
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setQuery("");
                  setKind("all");
                  setGroupFilter("all");
                  setTagFilter("all");
                }}
              >
                Wyczyść filtry
              </Button>
            )
          }
        />
      ) : view === "board" ? (
        <div className="grid gap-3 lg:grid-cols-4">
          {POST_STATUSES.map((status) => {
            const items = filtered.filter((post) => post.status === status.id);
            return (
              <div
                key={status.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId !== null) void moveStatus(dragId, status.id);
                  setDragId(null);
                }}
                className="flex min-h-[160px] flex-col rounded-[16px] border border-white/[0.06] bg-white/[0.015] p-2.5"
              >
                <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                  <span className="caps text-faint">{status.label}</span>
                  <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-faint">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onEdit={() => {
                        setEditing(post);
                        setEditorOpen(true);
                      }}
                      onCopy={() => copyBody(post)}
                      onPublish={() => setPublishing(post)}
                      onDuplicate={async () => {
                        if (!api) return;
                        await duplicatePost(api, post);
                        await refresh();
                        toast("Skopiowano wariant posta.");
                      }}
                      onDelete={() => setConfirmDelete(post)}
                      onDragStart={() => setDragId(post.id)}
                      onDragEnd={() => setDragId(null)}
                    />
                  ))}
                  {items.length === 0 ? (
                    <p className="px-1.5 py-3 text-[11.5px] text-faint/70">Upuść tutaj wpis.</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="divide-y divide-white/[0.06] p-0">
          {filtered.map((post) => (
            <div key={post.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[180px] flex-1">
                <p className="text-[13px] font-medium text-fg">{post.title || "Bez tytułu"}</p>
                <p className="text-[11.5px] text-faint">{truncate(post.body, 90)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {post.tags.map((tag) => (
                  <Badge key={tag}>{`#${tag}`}</Badge>
                ))}
              </div>
              <Badge tone={STATUS_TONE[post.status]}>
                {POST_STATUSES.find((item) => item.id === post.status)?.label}
              </Badge>
              <div className="flex items-center gap-1">
                <IconButton icon="copy" label="Kopiuj treść" size="xs" onClick={() => copyBody(post)} />
                <IconButton
                  icon="send"
                  label="Oznacz jako opublikowany"
                  size="xs"
                  onClick={() => setPublishing(post)}
                />
                <IconButton
                  icon="pencil"
                  label="Edytuj"
                  size="xs"
                  onClick={() => {
                    setEditing(post);
                    setEditorOpen(true);
                  }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      <PostEditor
        open={editorOpen}
        post={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <PublishDialog post={publishing} onClose={() => setPublishing(null)} />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Usunąć pomysł?"
        message="Treść zniknie razem z powiązanymi zdjęciami i tagami. Tej operacji nie da się cofnąć."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!api || !confirmDelete) return;
          await deletePost(api, confirmDelete.id);
          await refresh();
          setConfirmDelete(null);
          toast("Pomysł usunięty.");
        }}
      />
    </div>
  );
}

function PostCard({
  post,
  onEdit,
  onCopy,
  onPublish,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  post: Post;
  onEdit: () => void;
  onCopy: () => void;
  onPublish: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { workspace } = useApp();
  const group = workspace.groups.find((item) => item.id === post.group_id);
  const thumbs = post.media_ids
    .map((id) => workspace.media.find((item) => item.id === id))
    .filter(Boolean)
    .slice(0, 3);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group cursor-grab rounded-[14px] border border-white/[0.07] bg-[#101614] p-3 transition-colors hover:border-white/15 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-medium text-fg">
            {post.title || "Bez tytułu"}
          </p>
        </button>
        <Badge tone={STATUS_TONE[post.status]}>
          {POST_STATUSES.find((item) => item.id === post.status)?.label}
        </Badge>
      </div>

      <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-relaxed text-muted">
        {post.body || "Pusta treść."}
      </p>

      {thumbs.length > 0 ? (
        <div className="mt-2 flex gap-1.5">
          {thumbs.map((item) => (
            <Thumb key={item!.id} item={item!} />
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {post.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-[10.5px] text-faint">
            #{tag}
          </span>
        ))}
        {group ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-faint">
            <Icon name="group" size={11} /> {truncate(group.name, 16)}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-0.5 border-t border-white/[0.06] pt-2 opacity-70 transition-opacity group-hover:opacity-100">
        <IconButton icon="copy" label="Kopiuj treść" size="xs" onClick={onCopy} />
        <IconButton icon="send" label="Oznacz jako opublikowany" size="xs" onClick={onPublish} />
        <IconButton icon="copy" label="Duplikuj" size="xs" onClick={onDuplicate} />
        <IconButton icon="pencil" label="Edytuj" size="xs" onClick={onEdit} />
        <IconButton icon="trash" label="Usuń" size="xs" onClick={onDelete} />
        <span className="ml-auto text-[10px] text-faint/70">{relativeTime(post.updated_at)}</span>
      </div>
    </article>
  );
}

function Thumb({ item }: { item: { id: number; thumb_path: string } }) {
  const { api } = useApp();
  const url = useMediaUrl(api, item.thumb_path);
  return (
    <div className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 bg-black/30">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/5" />
      )}
    </div>
  );
}

function PostEditor({
  open,
  post,
  onClose,
}: {
  open: boolean;
  post: Post | null;
  onClose: () => void;
}) {
  const { api, workspace, toast, refresh } = useApp();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PostKind>("page");
  const [status, setStatus] = useState<PostStatus>("idea");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [mediaIds, setMediaIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTitle(post?.title ?? "");
    setBody(post?.body ?? "");
    setKind(post?.kind ?? "page");
    setStatus(post?.status ?? "idea");
    setGroupId(post?.group_id ?? null);
    setNotes(post?.notes ?? "");
    setTags(post?.tags ?? []);
    setMediaIds(post?.media_ids ?? []);
  }, [open, post]);

  const save = async () => {
    if (!api || !workspace.project) return;
    const payload = {
      project_id: workspace.project.id,
      title: title.trim(),
      body,
      kind,
      status,
      group_id: kind === "group" ? groupId : null,
      notes: notes.trim() || null,
    };
    try {
      if (post) {
        await updatePost(api, post.id, payload);
        await setPostTags(api, "post_tags", "post_id", post.id, tags);
        await api.setLinks("post_media", "post_id", post.id, "media_id", mediaIds);
      } else {
        const created = await createPost(api, payload);
        await setPostTags(api, "post_tags", "post_id", created.id, tags);
        await api.setLinks("post_media", "post_id", created.id, "media_id", mediaIds);
      }
      await refresh();
      toast(post ? "Pomysł zaktualizowany." : "Pomysł zapisany.");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zapisać.", "error");
    }
  };

  const steps = ["Treść", "Zdjęcia i tagi", "Ustawienia"];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={post ? "Edytuj pomysł" : "Nowy pomysł na post"}
      description="Trzy krótkie kroki — treść, materiały i ustawienia."
      width="lg"
      footer={
        <>
          {step > 0 ? (
            <Button variant="ghost" icon="chevronLeft" onClick={() => setStep((value) => value - 1)}>
              Wstecz
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Anuluj
            </Button>
          )}
          <div className="flex-1" />
          {step < steps.length - 1 ? (
            <Button variant="primary" iconRight="chevronRight" onClick={() => setStep((value) => value + 1)}>
              Dalej
            </Button>
          ) : (
            <Button variant="primary" icon="save" onClick={save}>
              Zapisz
            </Button>
          )}
        </>
      }
    >
      <StepHeader steps={steps} current={step} />

      {step === 0 ? (
        <div className="space-y-4">
          <Field label="Tytuł roboczy" hint="Krótki, wewnętrzny — nie musi być idealny.">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Np. 5 minut ciszy przed wyjściem"
            />
          </Field>
          <Field
            label="Treść"
            counter={
              <span className="text-[11px] text-faint">
                {body.length} znaków
              </span>
            }
            hint="Emoji są w porządku — wklej je z dowolnego źródła."
          >
            <Textarea
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Wpisz szkic treści…"
            />
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <Field label="Zdjęcia z biblioteki" hint="Kliknij miniaturę, aby dodać lub usunąć.">
            {workspace.media.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-[12px] text-faint">
                Biblioteka zdjęć jest pusta. Dodaj zdjęcia w sekcji „Zdjęcia”.
              </p>
            ) : (
              <div className="grid max-h-[260px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {workspace.media.map((item) => (
                  <MediaPick
                    key={item.id}
                    id={item.id}
                    thumb={item.thumb_path}
                    active={mediaIds.includes(item.id)}
                    onToggle={() =>
                      setMediaIds((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Field>
          <Field label="Tagi">
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={Array.from(new Set(workspace.tags.map((tag) => tag.name)))}
            />
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Typ treści">
              <Select
                value={kind}
                onChange={(event) => setKind(event.target.value as PostKind)}
                options={POST_KINDS.map((item) => ({ value: item.id, label: item.label }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as PostStatus)}
                options={POST_STATUSES.map((item) => ({ value: item.id, label: item.label }))}
              />
            </Field>
          </div>
          {kind === "group" ? (
            <Field label="Grupa docelowa" hint="Post trafi do historii tej grupy po oznaczeniu publikacji.">
              <Select
                value={groupId ?? ""}
                onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : null)}
                options={[
                  { value: "", label: "— wybierz grupę —" },
                  ...workspace.groups.map((group) => ({ value: String(group.id), label: group.name })),
                ]}
              />
            </Field>
          ) : null}
          <Field label="Notatki" hint="Pomocnicze — np. pomysł na zdjęcie albo wariant.">
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Notatki wewnętrzne…"
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

function MediaPick({
  id,
  thumb,
  active,
  onToggle,
}: {
  id: number;
  thumb: string;
  active: boolean;
  onToggle: () => void;
}) {
  const { api } = useApp();
  const url = useMediaUrl(api, thumb);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative aspect-square overflow-hidden rounded-xl border transition-all",
        active ? "border-accent ring-2 ring-accent/30" : "border-white/10 hover:border-white/25",
      )}
    >
      {url ? (
        <img src={url} alt={`Zdjęcie ${id}`} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/5" />
      )}
      {active ? (
        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[#0b0f0e]">
          <Icon name="check" size={12} />
        </span>
      ) : null}
    </button>
  );
}

function PublishDialog({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const { api, workspace, toast, refresh } = useApp();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!post) return;
    setGroupId(post.group_id ?? workspace.groups[0]?.id ?? null);
    setDate(toDateInput(new Date().toISOString()));
    setUrl("");
    setNote("");
  }, [post, workspace.groups]);

  const similar = useMemo(() => {
    if (!post || post.kind !== "group" || !groupId) return [];
    const publications = workspace.publications.filter((item) => item.group_id === groupId);
    return findSimilar(
      post.body,
      publications.map((item) => ({
        id: item.id,
        body: item.body_snapshot,
        label: `${formatDate(item.published_at)} · ${truncate(item.body_snapshot, 60)}`,
      })),
      0.4,
    );
  }, [post, groupId, workspace.publications]);

  const submit = async () => {
    if (!api || !post) return;
    try {
      await publishPost(api, post, {
        groupId: post.kind === "group" ? groupId : null,
        publishedAt: new Date(`${date}T12:00:00`).toISOString(),
        publishedUrl: url.trim() || null,
        outcomeNote: note.trim() || null,
      });
      await refresh();
      toast(
        post.kind === "group" && groupId
          ? "Oznaczono jako op-published i dodano do historii grupy."
          : "Oznaczono jako opublikowany.",
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zapisać.", "error");
    }
  };

  return (
    <Modal
      open={Boolean(post)}
      onClose={onClose}
      title="Oznacz jako opublikowany"
      description="SocialHQ nie publikuje niczego sam — zapisujemy tylko fakty i historię."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" icon="check" onClick={submit}>
            Zapisz publikację
          </Button>
        </>
      }
    >
      {post ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
            <SectionLabel className="mb-1.5">Treść posta</SectionLabel>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
              {post.body || "Pusta treść."}
            </p>
          </div>

          {post.kind === "group" ? (
            <Field label="Grupa" required>
              <Select
                value={groupId ?? ""}
                onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : null)}
                options={workspace.groups.map((group) => ({
                  value: String(group.id),
                  label: group.name,
                }))}
              />
            </Field>
          ) : null}

          {similar.length > 0 ? (
            <div className="rounded-xl border border-warn/30 bg-warn/10 p-3">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-warn">
                <Icon name="alert" size={15} /> Ta treść przypomina posty z tej grupy
              </p>
              <ul className="mt-2 space-y-1.5">
                {similar.slice(0, 3).map((match) => (
                  <li key={match.id} className="text-[11.5px] leading-relaxed text-warn/85">
                    • {match.label} — podobieństwo {Math.round(match.score * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data publikacji">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Link do posta" hint="Opcjonalnie.">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>

          <Field label="Wynik / notatka" hint="Np. „dużo komentarzy”, „usunięte przez admina”.">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Notatka po publikacji…"
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
