import { useEffect, useMemo, useState } from "react";
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
  TagInput,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  createPrompt,
  deletePrompt,
  duplicatePrompt,
  setTags,
  updatePrompt,
} from "@/lib/repo";
import { briefVariables, extractVariables, fillTemplate } from "@/lib/logic";
import { formatDate } from "@/lib/format";
import type { Prompt } from "@/types";

export function PromptsView() {
  const { api, workspace, toast, refresh, newItemNonce, consumeNewItem } = useApp();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "text" | "image">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [filling, setFilling] = useState<Prompt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prompt | null>(null);

  useEffect(() => {
    if (consumeNewItem()) {
      setEditing(null);
      setEditorOpen(true);
    }
  }, [newItemNonce]);

  const allTags = useMemo(
    () => Array.from(new Set(workspace.prompts.flatMap((prompt) => prompt.tags))).sort(),
    [workspace.prompts],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.prompts.filter((prompt) => {
      if (kind !== "all" && prompt.kind !== kind) return false;
      if (tagFilter !== "all" && !prompt.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      return (
        prompt.title.toLowerCase().includes(needle) ||
        prompt.body.toLowerCase().includes(needle) ||
        prompt.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [workspace.prompts, query, kind, tagFilter]);

  const copyPrompt = async (prompt: Prompt) => {
    if (!api) return;
    const variables = extractVariables(prompt.body);
    if (variables.length > 0) {
      setFilling(prompt);
      return;
    }
    await api.copyText(prompt.body);
    toast("Prompt skopiowany.");
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
            placeholder="Szukaj promptów…"
            className="pl-9"
          />
        </div>
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as "all" | "text" | "image")}
          className="w-[170px]"
          options={[
            { value: "all", label: "Wszystkie typy" },
            { value: "text", label: "Tekstowy" },
            { value: "image", label: "Graficzny" },
          ]}
        />
        <Select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="w-[150px]"
          options={[
            { value: "all", label: "Wszystkie tagi" },
            ...allTags.map((tag) => ({ value: tag, label: `#${tag}` })),
          ]}
        />
        <Button
          variant="primary"
          icon="plus"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          Nowy prompt
        </Button>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="wand"
          title="Brak promptów"
          description="Trzymaj tutaj gotowe instrukcje dla agentów AI. Zmienne w formacie {{nazwa}} uzupełnisz przy kopiowaniu."
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              Nowy prompt
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((prompt) => {
            const variables = extractVariables(prompt.body);
            return (
              <article
                key={prompt.id}
                className="flex flex-col rounded-[16px] border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/15"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(prompt);
                      setEditorOpen(true);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13.5px] font-medium text-fg">{prompt.title}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge tone={prompt.kind === "image" ? "info" : "neutral"}>
                      {prompt.kind === "image" ? "graficzny" : "tekstowy"}
                    </Badge>
                    <IconButton
                      icon="star"
                      label="Ulubiony"
                      size="xs"
                      variant={prompt.favorite ? "outline" : "ghost"}
                      onClick={async () => {
                        if (!api) return;
                        await updatePrompt(api, prompt.id, { favorite: prompt.favorite ? 0 : 1 });
                        await refresh();
                      }}
                    />
                  </div>
                </div>

                <p className="mono mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/25 p-2.5 text-[11.5px] leading-relaxed text-muted">
                  {prompt.body}
                </p>

                {variables.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Icon name="hash" size={12} className="text-faint" />
                    {variables.map((variable) => (
                      <span
                        key={variable}
                        className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent"
                      >
                        {`{{${variable}}}`}
                      </span>
                    ))}
                  </div>
                ) : null}

                {prompt.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {prompt.tags.map((tag) => (
                      <span key={tag} className="text-[10.5px] text-faint">
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex items-center gap-1 border-t border-white/[0.06] pt-2.5">
                  <Button size="xs" icon="copy" onClick={() => copyPrompt(prompt)}>
                    Kopiuj
                  </Button>
                  <IconButton
                    icon="copy"
                    label="Duplikuj"
                    size="xs"
                    onClick={async () => {
                      if (!api) return;
                      await duplicatePrompt(api, prompt);
                      await refresh();
                      toast("Prompt zduplikowany.");
                    }}
                  />
                  <IconButton
                    icon="pencil"
                    label="Edytuj"
                    size="xs"
                    onClick={() => {
                      setEditing(prompt);
                      setEditorOpen(true);
                    }}
                  />
                  <IconButton
                    icon="trash"
                    label="Usuń"
                    size="xs"
                    onClick={() => setConfirmDelete(prompt)}
                  />
                  <span className="ml-auto text-[10px] text-faint/70">
                    {formatDate(prompt.created_at)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <PromptEditor
        open={editorOpen}
        prompt={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <FillVariablesDialog prompt={filling} onClose={() => setFilling(null)} />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Usunąć prompt?"
        message="Prompt zniknie z biblioteki. Tej operacji nie da się cofnąć."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!api || !confirmDelete) return;
          await deletePrompt(api, confirmDelete.id);
          await refresh();
          setConfirmDelete(null);
          toast("Prompt usunięty.");
        }}
      />
    </div>
  );
}

function PromptEditor({
  open,
  prompt,
  onClose,
}: {
  open: boolean;
  prompt: Prompt | null;
  onClose: () => void;
}) {
  const { api, workspace, toast, refresh } = useApp();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"text" | "image">("text");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTagsState] = useState<string[]>([]);
  const [scope, setScope] = useState<"projekt" | "globalny">("projekt");
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? "");
    setKind(prompt?.kind ?? "text");
    setBody(prompt?.body ?? "");
    setNotes(prompt?.notes ?? "");
    setTagsState(prompt?.tags ?? []);
    setScope(prompt?.project_id === null ? "globalny" : "projekt");
    setFavorite(Boolean(prompt?.favorite));
  }, [open, prompt]);

  const save = async () => {
    if (!api) return;
    if (!title.trim() || !body.trim()) {
      toast("Tytuł i treść promptu są wymagane.", "error");
      return;
    }
    const payload = {
      project_id: scope === "globalny" ? null : (workspace.project?.id ?? null),
      title: title.trim(),
      kind,
      body,
      favorite: favorite ? 1 : 0,
      notes: notes.trim() || null,
    };
    try {
      if (prompt) {
        await updatePrompt(api, prompt.id, payload);
        await setTags(api, "prompt_tags", "prompt_id", prompt.id, tags);
      } else {
        const created = await createPrompt(api, payload);
        await setTags(api, "prompt_tags", "prompt_id", created.id, tags);
      }
      await refresh();
      toast(prompt ? "Prompt zaktualizowany." : "Prompt zapisany.");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zapisać promptu.", "error");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prompt ? "Edytuj prompt" : "Nowy prompt"}
      description="Użyj zmiennych {{nazwa}}, aby uzupełnić je przy kopiowaniu."
      width="lg"
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
          <Field label="Tytuł" required>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Post edukacyjny"
            />
          </Field>
          <Field label="Typ">
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as "text" | "image")}
              options={[
                { value: "text", label: "Tekstowy" },
                { value: "image", label: "Graficzny" },
              ]}
            />
          </Field>
        </div>
        <Field
          label="Treść promptu"
          required
          hint="Zmienne z briefu projektu są dostępne jako {{brief.ton}}, {{brief.opis}} i inne."
        >
          <Textarea
            rows={7}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Napisz post o temacie {{temat}}…"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Zakres">
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value as "projekt" | "globalny")}
              options={[
                { value: "projekt", label: "Tylko ten projekt" },
                { value: "globalny", label: "Globalny" },
              ]}
            />
          </Field>
          <Field label="Tagi">
            <TagInput value={tags} onChange={setTagsState} />
          </Field>
        </div>
        <Field label="Notatki">
          <Textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Kiedy użyć tego promptu…"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(event) => setFavorite(event.target.checked)}
            className="h-4 w-4 accent-[#BFEF00]"
          />
          Oznacz jako ulubiony
        </label>
      </div>
    </Modal>
  );
}

function FillVariablesDialog({
  prompt,
  onClose,
}: {
  prompt: Prompt | null;
  onClose: () => void;
}) {
  const { api, workspace, toast } = useApp();
  const [values, setValues] = useState<Record<string, string>>({});

  const variables = useMemo(
    () => (prompt ? extractVariables(prompt.body) : []),
    [prompt],
  );

  useEffect(() => {
    if (!prompt) return;
    const fromBrief = briefVariables(workspace.brief, workspace.project);
    const initial: Record<string, string> = {};
    for (const variable of extractVariables(prompt.body)) {
      initial[variable] = fromBrief[variable] ?? "";
    }
    setValues(initial);
  }, [prompt, workspace.brief, workspace.project]);

  const submit = async () => {
    if (!api || !prompt) return;
    const filled = fillTemplate(prompt.body, values);
    await api.copyText(filled);
    toast("Prompt uzupełniony i skopiowany.");
    onClose();
  };

  const unresolved = variables.filter((variable) => !values[variable]?.trim());

  return (
    <Modal
      open={Boolean(prompt)}
      onClose={onClose}
      title="Uzupełnij zmienne"
      description="Pola z briefu projektu są już wypełnione — uzupełnij resztę."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" icon="copy" onClick={submit}>
            Kopiuj gotowy prompt
          </Button>
        </>
      }
    >
      {prompt ? (
        <div className="space-y-4">
          {variables.length === 0 ? (
            <p className="text-[13px] text-muted">Ten prompt nie ma zmiennych.</p>
          ) : (
            variables.map((variable) => (
              <Field
                key={variable}
                label={`{{${variable}}}`}
                hint={
                  briefVariables(workspace.brief, workspace.project)[variable]
                    ? "Wzięte z briefu projektu."
                    : undefined
                }
              >
                <Input
                  value={values[variable] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [variable]: event.target.value }))
                  }
                  placeholder="wartość…"
                />
              </Field>
            ))
          )}

          <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
            <SectionLabel className="mb-2">Podgląd</SectionLabel>
            <p className="mono whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">
              {fillTemplate(prompt.body, values)}
            </p>
          </div>

          {unresolved.length > 0 ? (
            <p className="text-[11.5px] text-warn">
              Nieuzupełnione zmienne: {unresolved.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
