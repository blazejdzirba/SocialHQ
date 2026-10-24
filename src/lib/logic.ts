import type {
  Brief,
  Group,
  GroupPublication,
  Project,
  TaskTemplate,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Similarity detection                                                */
/* ------------------------------------------------------------------ */

/** Lowercases, folds diacritics and strips punctuation. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u0142/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits normalized text into a set of unique tokens. */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(" ").filter((token) => token.length > 1)));
}

/** Jaccard similarity of two token sets (0..1). */
export function jaccard(a: string[] | Set<string>, b: string[] | Set<string>): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Similarity of two raw texts, based on Jaccard over tokens. */
export function similarity(textA: string, textB: string): number {
  return jaccard(tokenize(textA), tokenize(textB));
}

export interface SimilarCandidate {
  id: number;
  body: string;
  label?: string;
}

export interface SimilarMatch {
  id: number;
  score: number;
  body: string;
  label?: string;
}

/**
 * Finds candidates whose text is close to the given text.
 * Used to warn about repeating content already published in a group.
 */
export function findSimilar(
  text: string,
  candidates: SimilarCandidate[],
  threshold = 0.35,
): SimilarMatch[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      body: candidate.body,
      label: candidate.label,
      score: jaccard(tokens, tokenize(candidate.body)),
    }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Prompt variables                                                    */
/* ------------------------------------------------------------------ */

const VARIABLE_PATTERN = /\{\{\s*([\w.\-]+)\s*\}\}/g;

/** Finds all `{{variable}}` placeholders inside a template. */
export function extractVariables(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** Replaces `{{variable}}` placeholders with provided values. */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(VARIABLE_PATTERN, (full, name: string) => {
    const value = values[name];
    return value === undefined || value === null || value === "" ? full : value;
  });
}

/** Variables that can be pulled straight from the project brief. */
export function briefVariables(
  brief: Brief | null | undefined,
  project?: Project | null,
): Record<string, string> {
  return {
    projekt: project?.name ?? "",
    platforma: project?.platform ?? "",
    "brief.opis": brief?.about ?? "",
    "brief.odbiorcy": brief?.audience ?? "",
    "brief.ton": brief?.tone ?? "",
    "brief.unikamy": brief?.avoid ?? "",
    "brief.zasady": brief?.rules ?? "",
    "brief.stale": brief?.fixed_elements ?? "",
    "brief.wizualne": brief?.visual_guidelines ?? "",
    "brief.kontekst": brief?.extra_context ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Context pack                                                        */
/* ------------------------------------------------------------------ */

export interface ContextSection {
  title: string;
  body: string;
}

export interface ContextPackInput {
  project: Project;
  brief: Brief;
  platformLabel?: string;
  sections?: ContextSection[];
  instruction?: string;
  instructionTitle?: string;
  group?: Group | null;
  publications?: GroupPublication[];
  now?: Date;
}

function section(title: string, body: string): ContextSection | null {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return null;
  return { title, body: trimmed };
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Builds the markdown "context package" that can be pasted into a web AI agent.
 * Everything is plain text so it survives copy/paste in any chat window.
 */
export function buildContextPack(input: ContextPackInput): string {
  const { project, brief } = input;
  const now = input.now ?? new Date();
  const chunks: string[] = [];

  chunks.push(`# PAKIET KONTEKSTOWY — ${project.name}`);
  chunks.push("");
  chunks.push(`- Projekt: ${project.name}`);
  chunks.push(`- Platforma: ${input.platformLabel ?? project.platform}`);
  if (project.url) chunks.push(`- Adres strony: ${project.url}`);
  chunks.push(`- Wygenerowano: ${formatStamp(now)}`);
  chunks.push("");
  chunks.push("---");

  const sections: ContextSection[] = [
    ...(input.sections ?? []),
    section("1. Czym jest projekt", brief.about),
    section("2. Odbiorcy", brief.audience),
    section("3. Ton komunikacji", brief.tone),
    section("4. Czego unikamy", brief.avoid),
    section("5. Zasady i ograniczenia", brief.rules),
    section("6. Stałe elementy (hashtagi, CTA, link)", brief.fixed_elements),
    section("7. Wytyczne wizualne", brief.visual_guidelines),
    section("8. Dodatkowy kontekst", brief.extra_context),
  ].filter((value): value is ContextSection => value !== null);

  if (input.group) {
    const group = input.group;
    const body: string[] = [];
    if (group.topic) body.push(`Tematyka: ${group.topic}`);
    if (group.members) body.push(`Liczba członków: ${group.members}`);
    if (group.rules) body.push(`Zasady grupy / ograniczenia:\n${group.rules}`);
    if (group.notes) body.push(`Notatki:\n${group.notes}`);
    sections.push({
      title: "Grupa docelowa",
      body: body.join("\n\n"),
    });

    const publications = (input.publications ?? []).slice(0, 5);
    if (publications.length > 0) {
      const rendered = publications
        .map(
          (publication, index) =>
            `### Post ${index + 1} (${publication.published_at.slice(0, 10)})\n${publication.body_snapshot}`,
        )
        .join("\n\n");
      sections.push({
        title: "Ostatnie posty wrzucone do tej grupy (nie powtarzaj ich treści)",
        body: rendered,
      });
    }
  }

  sections.forEach((item, index) => {
    const number = typeof item.title[0] === "string" && /^\d+\./.test(item.title)
      ? item.title
      : `${index + 1}. ${item.title}`;
    chunks.push("");
    chunks.push(`## ${number}`);
    chunks.push(item.body);
  });

  if (input.instruction && input.instruction.trim()) {
    chunks.push("");
    chunks.push("---");
    chunks.push("");
    chunks.push(`## ZADANIE — ${input.instructionTitle ?? "treść"}`);
    chunks.push(input.instruction.trim());
    chunks.push("");
    chunks.push(
      "Odpowiedz gotową treścią (bez dodatkowych wyjaśnień). Jeśli czegoś brakuje w pakiecie, zapytaj wprost.",
    );
  }

  return chunks.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

/** Very rough token estimate (good enough for a counter). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/* ------------------------------------------------------------------ */
/* Built-in quick tasks                                                */
/* ------------------------------------------------------------------ */

export interface QuickTask {
  key: string;
  title: string;
  kind: "text" | "image" | "ideas";
  instruction: string;
  needsGroup?: boolean;
}

export const QUICK_TASKS: QuickTask[] = [
  {
    key: "page",
    title: "Potrzebuję treści nowego posta na stronę",
    kind: "text",
    instruction:
      "Napisz 3 propozycje treści posta na stronę fanpage'a. Każda propozycja: krótki nagłówek, treść (3–6 krótkich zdań, bez lania wody) oraz 3–5 hashtagów pasujących do tonu projektu. Trzymaj się zasad z pakietu.",
  },
  {
    key: "group",
    title: "Potrzebuję treści posta do grupy",
    kind: "text",
    needsGroup: true,
    instruction:
      "Napisz treść posta do wskazanej grupy. Uwzględnij zasady tej grupy i NIE powtarzaj treści postów, które wrzucaliśmy do niej wcześniej (są w sekcji o ostatnich postach). Zaproponuj 2 warianty do wyboru.",
  },
  {
    key: "image",
    title: "Potrzebuję grafiki dopasowanej do projektu",
    kind: "image",
    instruction:
      "Przygotuj brief na grafikę: prompt do generatora obrazów (po polsku i po angielsku), opis kompozycji, paletę kolorów, nastrój oraz 3 warianty proporcji. Grafika ma być spójna z wytycznymi wizualnymi projektu.",
  },
  {
    key: "ideas",
    title: "Potrzebuję 10 pomysłów na posty",
    kind: "ideas",
    instruction:
      "Podaj 10 pomysłów na posty w formie listy. Dla każdego: tytuł roboczy, one-liner z treścią, format (karuzela, grafika z tekstem, zdjęcie, anegdota), CTA oraz sugerowany status (Pomysł / Szkic).",
  },
];

/** Builds a quick-task instruction with dynamic values (e.g. selected group). */
export function quickTaskInstruction(
  task: QuickTask | TaskTemplate,
  group?: Group | null,
): string {
  const base = task.instruction;
  if (!group) return base;
  return `${base}\n\nGrupa docelowa: „${group.name}”.`;
}
