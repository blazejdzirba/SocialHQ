import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/state/AppContext";
import { Button, Card, Field, Input, Modal, SectionLabel, Select, Textarea, IconButton } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  QUICK_TASKS,
  buildContextPack,
  estimateTokens,
  quickTaskInstruction,
  type QuickTask,
} from "@/lib/logic";
import { saveBrief, createTemplate, deleteTemplate } from "@/lib/repo";
import type { Brief, TaskTemplate } from "@/types";

const BRIEF_FIELDS: {
  key: keyof Brief;
  label: string;
  hint: string;
  rows: number;
  wide?: boolean;
}[] = [
  {
    key: "about",
    label: "Czym jest projekt",
    hint: "Krótko i konkretnie — to wchodzi do pakietu jako pierwsza sekcja.",
    rows: 5,
    wide: true,
  },
  {
    key: "audience",
    label: "Odbiorcy",
    hint: "Do kogo piszemy i w jakiej sytuacji.",
    rows: 4,
  },
  {
    key: "tone",
    label: "Ton komunikacji",
    hint: "Język, długość zdań, emocje.",
    rows: 4,
  },
  {
    key: "avoid",
    label: "Słowa i tematy których unikamy",
    hint: "Zakazane sformułowania, tematy, wizualia.",
    rows: 4,
  },
  {
    key: "rules",
    label: "Zasady i ograniczenia",
    hint: "Reguły redakcyjne, prawne, platformowe.",
    rows: 4,
  },
  {
    key: "fixed_elements",
    label: "Stałe elementy",
    hint: "Hashtagi, CTA, link do aplikacji, nazwa marki.",
    rows: 3,
  },
  {
    key: "visual_guidelines",
    label: "Wytyczne wizualne",
    hint: "Styl grafik, paleta, nastrój, czego unikać.",
    rows: 3,
  },
  {
    key: "extra_context",
    label: "Dodatkowy kontekst",
    hint: "Cokolwiek jeszcze ważnego dla agenta.",
    rows: 3,
    wide: true,
  },
];

export function BriefView() {
  const { api, workspace, toast, refresh, setSection, newItemNonce, consumeNewItem } = useApp();
  const project = workspace.project;
  const brief = workspace.brief;

  const [draft, setDraft] = useState<Brief | null>(brief);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setDraft(brief);
  }, [brief]);

  const update = useCallback((key: keyof Brief, value: string) => {
    dirty.current = true;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }, []);

  // Autosave: a few seconds after the last keystroke.
  useEffect(() => {
    if (!draft || !api || !project) return undefined;
    if (!dirty.current) return undefined;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        await saveBrief(api, draft);
        dirty.current = false;
        setSavedAt(new Date());
        await refresh();
      } catch (error) {
        toast(
          error instanceof Error ? error.message : "Nie udało się zapisać briefu.",
          "error",
        );
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, api, project, refresh, toast]);

  const selectedGroup = useMemo(
    () => workspace.groups.find((group) => group.id === groupId) ?? null,
    [workspace.groups, groupId],
  );

  const groupPublications = useMemo(
    () =>
      selectedGroup
        ? workspace.publications.filter((item) => item.group_id === selectedGroup.id)
        : [],
    [workspace.publications, selectedGroup],
  );

  const platformLabel = useMemo(
    () => workspace.platforms.find((item) => item.id === project?.platform)?.label ?? "",
    [workspace.platforms, project],
  );

  const basePack = useMemo(() => {
    if (!project || !draft) return "";
    return buildContextPack({
      project,
      brief: draft,
      platformLabel,
      group: selectedGroup,
      publications: groupPublications,
    });
  }, [project, draft, platformLabel, selectedGroup, groupPublications]);

  const copy = useCallback(
    async (text: string, message: string) => {
      if (!api) return;
      try {
        await api.copyText(text);
        toast(message);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Nie udało się skopiować.", "error");
      }
    },
    [api, toast],
  );

  const runQuickTask = useCallback(
    async (task: QuickTask) => {
      if (!project || !draft) return;
      const group = task.needsGroup ? selectedGroup : null;
      const pack = buildContextPack({
        project,
        brief: draft,
        platformLabel,
        group,
        publications: task.needsGroup ? groupPublications : [],
        instruction: quickTaskInstruction(task, group),
        instructionTitle: task.title,
      });
      await copy(pack, `Skopiowano pakiet z zadaniem: ${task.title.toLowerCase()}`);
    },
    [project, draft, platformLabel, selectedGroup, groupPublications, copy],
  );

  // Ctrl+N w sekcji brief przenosi do pomysłów.
  useEffect(() => {
    if (newItemNonce > 0 && !consumeNewItem()) return;
    if (newItemNonce > 0) setSection("posts");
  }, [newItemNonce, consumeNewItem, setSection]);

  // Ctrl+Shift+C copies the context package from anywhere in the app.
  useEffect(() => {
    const handler = () => {
      void copy(basePack, "Skopiowano pakiet kontekstowy");
    };
    window.addEventListener("socialhq:copy-pack", handler);
    return () => window.removeEventListener("socialhq:copy-pack", handler);
  }, [basePack, copy]);

  const runTemplate = useCallback(
    async (template: TaskTemplate) => {
      if (!project || !draft) return;
      const pack = buildContextPack({
        project,
        brief: draft,
        platformLabel,
        instruction: template.instruction,
        instructionTitle: template.title,
      });
      await copy(pack, `Skopiowano pakiet z zadaniem: ${template.title.toLowerCase()}`);
    },
    [project, draft, platformLabel, copy],
  );

  if (!project || !draft) {
    return (
      <Card>
        <p className="text-[13px] text-muted">
          Brak aktywnego projektu. Wybierz lub utwórz projekt w przełączniku po lewej.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: project.color }}
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold tracking-tight text-fg">{project.name}</h2>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-muted">
              {platformLabel}
            </span>
          </div>
          {project.url ? (
            <button
              type="button"
              onClick={() => api?.openExternal(project.url as string)}
              className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-accent"
            >
              <Icon name="link" size={13} />
              {project.url}
              <Icon name="external" size={12} />
            </button>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-faint">Brak adresu strony.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {project.url ? (
            <Button
              icon="external"
              onClick={() => api?.openExternal(project.url as string)}
            >
              Otwórz w przeglądarce
            </Button>
          ) : null}
          <Button icon="idea" onClick={() => setSection("posts")}>
            Pomysły
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>Brief projektu</SectionLabel>
            <p className="mt-1 text-[12.5px] text-faint">
              Wszystkie pola składają się w jeden blok tekstu gotowy do wklejenia w agenta AI.
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
            {saving ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Zapisywanie…
              </>
            ) : savedAt ? (
              <>
                <Icon name="check" size={13} className="text-accent" /> Zapisano
              </>
            ) : (
              "Zmiany zapisują się automatycznie"
            )}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {BRIEF_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={field.hint}
              className={field.wide ? "md:col-span-2" : undefined}
            >
              <Textarea
                rows={field.rows}
                value={String(draft[field.key] ?? "")}
                onChange={(event) => update(field.key, event.target.value)}
                placeholder="—"
              />
            </Field>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="flex flex-col">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Podgląd pakietu kontekstowego</SectionLabel>
            <div className="flex items-center gap-2 text-[11px] text-faint">
              <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                {basePack.length.toLocaleString("pl-PL")} znaków
              </span>
              <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                ~{estimateTokens(basePack)} tokenów
              </span>
            </div>
          </div>
          <pre className="mono scroll-thin max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-black/30 p-4 text-[12px] leading-relaxed text-muted">
            {basePack}
          </pre>
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionLabel className="mb-3">Kopiuj pakiet</SectionLabel>
            <Button
              variant="primary"
              icon="copy"
              className="w-full"
              onClick={() => copy(basePack, "Skopiowano pakiet kontekstowy")}
            >
              Kopiuj pakiet kontekstowy
            </Button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Blok tekstu z briefem, gotowy do wklejenia w webowego agenta AI.
            </p>
          </Card>

          <Card>
            <SectionLabel className="mb-3">Szybkie zadania</SectionLabel>
            <div className="space-y-2">
              {QUICK_TASKS.map((task) => (
                <div key={task.key}>
                  {task.needsGroup ? (
                    <div className="mb-2">
                      <Select
                        value={groupId ?? ""}
                        onChange={(event) =>
                          setGroupId(event.target.value ? Number(event.target.value) : null)
                        }
                        options={[
                          { value: "", label: "— wybierz grupę —" },
                          ...workspace.groups.map((group) => ({
                            value: String(group.id),
                            label: group.name,
                          })),
                        ]}
                      />
                    </div>
                  ) : null}
                  <Button
                    className="w-full justify-start"
                    icon={task.kind === "image" ? "image" : task.kind === "ideas" ? "layers" : "send"}
                    onClick={() => runQuickTask(task)}
                    disabled={task.needsGroup && !selectedGroup}
                  >
                    {task.title}
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionLabel>Własne szablony</SectionLabel>
              <IconButton
                icon="plus"
                label="Dodaj szablon"
                size="xs"
                variant="outline"
                onClick={() => setTemplateOpen(true)}
              />
            </div>
            {workspace.templates.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-faint">
                Brak własnych szablonów. Dodaj własne gotowe instrukcje, np. „Napisz post na
                święto”.
              </p>
            ) : (
              <div className="space-y-1.5">
                {workspace.templates.map((template) => (
                  <div
                    key={template.id}
                    className="group flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => runTemplate(template)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[12.5px] text-fg">{template.title}</span>
                      <span className="block truncate text-[10.5px] text-faint">
                        {template.instruction}
                      </span>
                    </button>
                    <IconButton
                      icon="copy"
                      label="Kopiuj pakiet z zadaniem"
                      size="xs"
                      onClick={() => runTemplate(template)}
                    />
                    <IconButton
                      icon="trash"
                      label="Usuń szablon"
                      size="xs"
                      onClick={async () => {
                        if (!api) return;
                        await deleteTemplate(api, template.id);
                        await refresh();
                        toast("Szablon usunięty.");
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <TemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        projectId={project.id}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
}) {
  const { api, refresh, toast } = useApp();
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<"text" | "image" | "ideas">("text");

  const submit = async () => {
    if (!api) return;
    if (!title.trim() || !instruction.trim()) {
      toast("Tytuł i instrukcja są wymagane.", "error");
      return;
    }
    await createTemplate(api, {
      project_id: projectId,
      title: title.trim(),
      kind,
      instruction: instruction.trim(),
      sort_order: 99,
    });
    await refresh();
    toast("Szablon zadania dodany.");
    setTitle("");
    setInstruction("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nowy szablon zadania"
      description="Własna instrukcja doklejana do pakietu kontekstowego."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" icon="save" onClick={submit}>
            Zapisz szablon
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tytuł" required>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Napisz post na święto"
          />
        </Field>
        <Field label="Rodzaj" hint="Pomaga oznaczyć szablon na liście.">
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as "text" | "image" | "ideas")}
            options={[
              { value: "text", label: "Treść tekstowa" },
              { value: "image", label: "Grafika" },
              { value: "ideas", label: "Pomysły" },
            ]}
          />
        </Field>
        <Field label="Instrukcja" required hint="Dopisana na końcu pakietu jako „ZADANIE”.">
          <Textarea
            rows={5}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Napisz 3 propozycje posta na święto…"
          />
        </Field>
      </div>
    </Modal>
  );
}
