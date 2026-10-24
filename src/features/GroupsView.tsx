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
  TagInput,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { bulkCreateGroups, createGroup, deleteGroup, updateGroup, setTags } from "@/lib/repo";
import { daysSince, formatDate, relativeTime, truncate } from "@/lib/format";
import type { Group } from "@/types";

export function GroupsView() {
  const {
    api,
    workspace,
    toast,
    refresh,
    newItemNonce,
    consumeNewItem,
    selectedGroupId,
    setSelectedGroupId,
  } = useApp();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Group | null>(null);

  useEffect(() => {
    if (consumeNewItem()) {
      setEditing(null);
      setEditorOpen(true);
    }
  }, [newItemNonce]);

  const selected =
    workspace.groups.find((group) => group.id === selectedGroupId) ?? workspace.groups[0] ?? null;

  const publications = useMemo(
    () =>
      selected
        ? workspace.publications.filter((item) => item.group_id === selected.id)
        : [],
    [workspace.publications, selected],
  );

  const lastPublication = publications[0] ?? null;
  const daysSinceLast = lastPublication ? daysSince(lastPublication.published_at) : null;

  const openGroup = async (group: Group) => {
    setSelectedGroupId(group.id);
    if (group.url && api) await api.openExternal(group.url);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button
            variant="primary"
            icon="plus"
            className="flex-1"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            Nowa grupa
          </Button>
          <Button icon="upload" onClick={() => setBulkOpen(true)}>
            Wklej listę
          </Button>
        </div>

        {workspace.groups.length === 0 ? (
          <Card>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Nie masz jeszcze żadnych grup. Dodaj je ręcznie albo wklej listę adresów — SocialHQ
              zapamięta zasady i historię każdej z nich.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {workspace.groups.map((group) => {
              const active = selected?.id === group.id;
              const count = workspace.publications.filter(
                (item) => item.group_id === group.id,
              ).length;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={cn(
                    "w-full rounded-[14px] border p-3 text-left transition-colors",
                    active
                      ? "border-accent/40 bg-accent/[0.07]"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {group.pinned ? <Icon name="pin" size={13} className="text-accent" /> : null}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                      {group.name}
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-faint">
                      {count}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-faint">
                    {group.topic ?? "Brak tematyki"}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-fg">{selected.name}</h2>
                  {selected.pinned ? <Badge tone="accent">przypięta</Badge> : null}
                </div>
                {selected.topic ? (
                  <p className="mt-1 text-[12.5px] text-muted">{selected.topic}</p>
                ) : null}
                {selected.url ? (
                  <button
                    type="button"
                    onClick={() => api?.openExternal(selected.url as string)}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-accent"
                  >
                    <Icon name="link" size={12} />
                    {truncate(selected.url, 54)}
                    <Icon name="external" size={11} />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selected.url ? (
                  <Button icon="external" onClick={() => openGroup(selected)}>
                    Otwórz w przeglądarce
                  </Button>
                ) : null}
                <Button
                  icon="copy"
                  onClick={async () => {
                    if (!api || !selected.url) return;
                    await api.copyText(selected.url);
                    toast("Link skopiowany.");
                  }}
                >
                  Kopiuj link
                </Button>
                <IconButton
                  icon="pencil"
                  label="Edytuj grupę"
                  onClick={() => {
                    setEditing(selected);
                    setEditorOpen(true);
                  }}
                />
                <IconButton
                  icon="trash"
                  label="Usuń grupę"
                  onClick={() => setConfirmDelete(selected)}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat
                label="Członków"
                value={selected.members ? selected.members.toLocaleString("pl-PL") : "—"}
              />
              <Stat
                label="Wrzuconych postów"
                value={String(publications.length)}
              />
              <Stat
                label="Ostatni post"
                value={
                  daysSinceLast === null
                    ? "nigdy"
                    : daysSinceLast === 0
                      ? "dziś"
                      : `${daysSinceLast} dni temu`
                }
                tone={daysSinceLast !== null && daysSinceLast > 30 ? "warn" : "default"}
              />
            </div>

            {selected.rules ? (
              <div className="mt-4 rounded-xl border border-warn/20 bg-warn/[0.07] p-3">
                <SectionLabel className="mb-1.5 text-warn">Zasady i ograniczenia</SectionLabel>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                  {selected.rules}
                </p>
              </div>
            ) : null}

            {selected.notes ? (
              <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <SectionLabel className="mb-1.5">Notatki</SectionLabel>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                  {selected.notes}
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <SectionLabel>Historia postów w tej grupie</SectionLabel>
              <span className="text-[11px] text-faint">od najnowszych</span>
            </div>

            {publications.length === 0 ? (
              <EmptyState
                icon="clock"
                title="Jeszcze nic tu nie wrzuciliśmy"
                description="Gdy oznaczysz post jako opublikowany w tej grupie, jego treść zapisze się tutaj jako migawka."
              />
            ) : (
              <ol className="relative space-y-4 border-l border-white/[0.08] pl-5">
                {publications.map((publication) => (
                  <li key={publication.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent/70" />
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
                      <span className="text-fg">{formatDate(publication.published_at)}</span>
                      <span>·</span>
                      <span>{relativeTime(publication.published_at)}</span>
                      {publication.outcome_note ? (
                        <Badge tone="info">{publication.outcome_note}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/20 p-2.5 text-[12px] leading-relaxed text-muted">
                      {publication.body_snapshot}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {publication.post_url ? (
                        <button
                          type="button"
                          onClick={() => api?.openExternal(publication.post_url as string)}
                          className="inline-flex items-center gap-1.5 text-[11.5px] text-faint transition-colors hover:text-accent"
                        >
                          <Icon name="external" size={12} /> link do posta
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={async () => {
                          if (!api) return;
                          await api.copyText(publication.body_snapshot);
                          toast("Migawka treści skopiowana.");
                        }}
                        className="inline-flex items-center gap-1.5 text-[11.5px] text-faint transition-colors hover:text-accent"
                      >
                        <Icon name="copy" size={12} /> kopiuj treść
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon="group"
            title="Wybierz grupę albo dodaj nową"
            description="Dla każdej grupy pamiętasz zasady, link i historię wrzuconych postów."
          />
        </Card>
      )}

      <GroupEditor
        open={editorOpen}
        group={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <BulkAddDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Usunąć grupę?"
        message="Grupa zniknie razem z historią publikacji. Zawartość postów zostanie w pomysłach."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!api || !confirmDelete) return;
          await deleteGroup(api, confirmDelete.id);
          await refresh();
          setConfirmDelete(null);
          setSelectedGroupId(null);
          toast("Grupa usunięta.");
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <div className="caps text-faint">{label}</div>
      <div
        className={cn(
          "mt-1 text-[15px] font-medium",
          tone === "warn" ? "text-warn" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function GroupEditor({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: Group | null;
  onClose: () => void;
}) {
  const { api, workspace, toast, refresh } = useApp();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [members, setMembers] = useState("");
  const [rules, setRules] = useState("");
  const [notes, setNotes] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tags, setTagsState] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setUrl(group?.url ?? "");
    setTopic(group?.topic ?? "");
    setMembers(group?.members ? String(group.members) : "");
    setRules(group?.rules ?? "");
    setNotes(group?.notes ?? "");
    setPinned(Boolean(group?.pinned));
    setTagsState(group?.tags ?? []);
  }, [open, group]);

  const save = async () => {
    if (!api || !workspace.project) return;
    if (!name.trim()) {
      toast("Nazwa grupy jest wymagana.", "error");
      return;
    }
    const payload = {
      project_id: workspace.project.id,
      name: name.trim(),
      url: url.trim() || null,
      topic: topic.trim() || null,
      members: members ? Number(members) : null,
      rules: rules.trim() || null,
      notes: notes.trim() || null,
      pinned: pinned ? 1 : 0,
    };
    try {
      if (group) {
        await updateGroup(api, group.id, payload);
        await setTags(api, "group_tags", "group_id", group.id, tags);
      } else {
        const created = await createGroup(api, payload);
        await setTags(api, "group_tags", "group_id", created.id, tags);
      }
      await refresh();
      toast(group ? "Grupa zaktualizowana." : "Grupa dodana.");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zapisać grupy.", "error");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group ? "Edytuj grupę" : "Nowa grupa"}
      description="Zasady grupy trafiają do pakietu kontekstowego przy zadaniu „post do grupy”."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" icon="save" onClick={save}>
            Zapisz
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nazwa grupy" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="np. Grupa wsparcia" />
          </Field>
          <Field label="Liczba członków" hint="Opcjonalnie, wpisuj ręcznie.">
            <Input
              type="number"
              value={members}
              onChange={(event) => setMembers(event.target.value)}
              placeholder="1200"
            />
          </Field>
        </div>
        <Field label="Adres grupy">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.facebook.com/groups/…"
          />
        </Field>
        <Field label="Tematyka">
          <Input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="np. codzienne wsparcie osób w trzeźwości"
          />
        </Field>
        <Field label="Zasady grupy / ograniczenia" hint="Np. zakaz linków, wymagana zgoda admina.">
          <Textarea
            rows={4}
            value={rules}
            onChange={(event) => setRules(event.target.value)}
            placeholder="Zasady…"
          />
        </Field>
        <Field label="Notatki">
          <Textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notatki…"
          />
        </Field>
        <Field label="Tagi">
          <TagInput value={tags} onChange={setTagsState} placeholder="np. codzienność" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="h-4 w-4 accent-[#BFEF00]"
          />
          Przypnij na górze listy
        </label>
      </div>
    </Modal>
  );
}

function BulkAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, workspace, toast, refresh } = useApp();
  const [text, setText] = useState("");

  const submit = async () => {
    if (!api || !workspace.project) return;
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      toast("Wklej przynajmniej jeden adres.", "error");
      return;
    }
    const result = await bulkCreateGroups(api, workspace.project.id, lines);
    await refresh();
    toast(`Dodano ${result.created} grup${result.skipped ? `, pominięto ${result.skipped}` : ""}.`);
    setText("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dodaj wiele grup naraz"
      description="Wklej listę adresów — każdy w osobnej linii. Duplikaty zostaną pominięte."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" icon="plus" onClick={submit}>
            Dodaj grupy
          </Button>
        </>
      }
    >
      <Field label="Lista adresów" hint="Obsługiwane są pełne linki oraz same nazwy grup.">
        <Textarea
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"https://www.facebook.com/groups/grupa-pierwsza\nhttps://www.facebook.com/groups/grupa-druga"}
        />
      </Field>
    </Modal>
  );
}
