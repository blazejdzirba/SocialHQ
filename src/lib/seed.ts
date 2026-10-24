import type { DataApi } from "./store";
import { DEFAULT_MEDIA_CATEGORIES } from "@/types";

const PLATFORMS = [
  { id: "facebook", label: "Facebook", color: "#1877F2", sort_order: 0 },
  { id: "instagram", label: "Instagram", color: "#E1306C", sort_order: 1 },
  { id: "x", label: "X (Twitter)", color: "#8B98A5", sort_order: 2 },
  { id: "tiktok", label: "TikTok", color: "#25F4EE", sort_order: 3 },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2", sort_order: 4 },
  { id: "youtube", label: "YouTube", color: "#FF0000", sort_order: 5 },
];

const TEMPLATE_INSTRUCTIONS = [
  {
    title: "Potrzebuję treści nowego posta na stronę",
    kind: "text",
    instruction:
      "Napisz 3 propozycje treści posta na stronę fanpage'a. Każda propozycja: krótki nagłówek, treść (3–6 krótkich zdań, bez lania wody) oraz 3–5 hashtagów pasujących do tonu projektu. Trzymaj się zasad z pakietu.",
  },
  {
    title: "Potrzebuję treści posta do grupy",
    kind: "text",
    instruction:
      "Napisz treść posta do wskazanej grupy. Uwzględnij zasady tej grupy i NIE powtarzaj treści postów, które wrzucaliśmy do niej wcześniej (są w sekcji o ostatnich postach). Zaproponuj 2 warianty do wyboru.",
  },
  {
    title: "Potrzebuję grafiki dopasowanej do projektu",
    kind: "image",
    instruction:
      "Przygotuj brief na grafikę: prompt do generatora obrazów (po polsku i po angielsku), opis kompozycji, paletę kolorów, nastrój oraz 3 warianty proporcji. Grafika ma być spójna z wytycznymi wizualnymi projektu.",
  },
  {
    title: "Potrzebuję 10 pomysłów na posty",
    kind: "ideas",
    instruction:
      "Podaj 10 pomysłów na posty w formie listy. Dla każdego: tytuł roboczy, one-liner z treścią, format (karuzela, grafika z tekstem, zdjęcie, anegdota), CTA oraz sugerowany status (Pomysł / Szkic).",
  },
];

const SAMPLE_PROMPTS = [
  {
    title: "Post edukacyjny",
    kind: "text",
    body: "Napisz krótki post edukacyjny na stronę {{platforma}} o temacie: {{temat}}. Utrzymaj ton: {{brief.ton}}. Zakończ wezwaniem do działania: {{cta}}. Unikaj: {{brief.unikamy}}.",
    notes: "Działa najlepiej z jednym konkretnym tematem, np. „lzenie głodu”.",
    tags: ["edukacja", "strona"],
  },
  {
    title: "Post angażujący z pytaniem",
    kind: "text",
    body: "Napisz angażujący post do grupy o temacie {{temat}}, który kończy się pytaniem do czytelników. Krótkie zdania, bez wykrzykników. Ton: {{brief.ton}}.",
    notes: "",
    tags: ["grupa", "zaangażowanie"],
  },
  {
    title: "Grafika: spokojna ilustracja do cytatu",
    kind: "image",
    body: "Narysuj spokojną ilustrację: {{grafika}}. Styl: {{brief.wizualne}}. Bez tekstu poza krótkim hasłem.",
    notes: "Dobre miejsce na cytat motywacyjny.",
    tags: ["grafika", "cytat"],
  },
];

const SAMPLE_GROUP = {
  name: "Grupa wsparcia — codziennie",
  url: "https://www.facebook.com/groups/przykladowa-grupa",
  topic: "Codzienne wsparcie osób w trzeźwości",
  members: 1240,
  rules:
    "Zakaz linków do sklepów i aptek. Nie publikujemy numerów telefonów i adresów. Przy treściach sponsorowanych wymagana zgoda administratora.",
  notes: "Najlepiej reaguje na posty z konkretnym ćwiczeniem na dziś.",
  pinned: 1,
};

/**
 * Creates the starting workspace: the SoberBro project with a ready to edit
 * brief, quick task templates, example prompts and one sample group.
 */
export async function ensureSeed(api: DataApi): Promise<void> {
  const projects = await api.all("projects");
  if (projects.length > 0) return;

  const now = new Date().toISOString();

  for (const platform of PLATFORMS) {
    await api.insert("platforms", platform);
  }

  const project = await api.insert<{ id: number }>("projects", {
    name: "SoberBro",
    platform: "facebook",
    url: "https://www.facebook.com/soberbro",
    color: "#BFEF00",
    icon: "leaf",
    created_at: now,
  });
  const projectId = Number(project.id);

  await api.insert("project_briefs", {
    project_id: projectId,
    about:
      "SoberBro to polska, bezpłatna aplikacja wspierająca osoby w trzeźwości i w odstawianiu używek. Zawiera licznik dni trzeźwości, dziennik, „apteczkę” (spersonalizowany plan na trudny moment), plan na głód, ćwiczenia (np. uziemienie 5-4-3-2-1, oddech 4-7-8), rozmówców online, znajomych i anonimowe forum. Jest anonimowa i nieoceniająca.",
    audience:
      "Dorośli Polacy walczący z uzależnieniem lub chcący ograniczyć używki, oraz ich bliscy.",
    tone:
      "Ciepły, spokojny, wspierający, na „Ty”, bez moralizowania, bez szoku i straszenia, bez cukierkowości. Krótkie zdania.",
    avoid:
      "Porad medycznych i obietnic leczenia, określeń piętnujących („alkoholik”, „ćpun”), glorifikowania używania, zdjęć i opisów substancji, nierealnych obietnic („wyleczysz się w 30 dni”), publikowania danych użytkowników.",
    rules:
      "Przy treściach o kryzysie dodaj informację, że w nagłym zagrożeniu życia należy dzwonić na 112 lub szukać pomocy specjalisty. Nie podajemy się za terapię ani zamiennik leczenia.",
    fixed_elements:
      "Nazwa: SoberBro. Link do aplikacji: [uzupełnij]. CTA: „Pobierz darmową apkę i policz swój pierwszy dzień”. Hashtagi: #trzeźwość #soberbro #wsparcie",
    extra_context:
      "Aplikacja jest w pełni darmowa i anonimowa. Nie zbieramy danych osobowych, nie ma rejestracji. Materiały publikujemy ręcznie — nie uruchamiamy automatycznych kampanii.",
    visual_guidelines:
      "Ciemna, spokojna estetyka. Mgliste góry, szlak i dwoje wędrowców. Głęboka zieleń, granat i szarość z limonkowym akcentem. Bez tekstu na grafice poza krótkimi hasłami. Bez elementów alkoholowych i narkotykowych.",
    updated_at: now,
  });

  for (const [index, template] of TEMPLATE_INSTRUCTIONS.entries()) {
    await api.insert("task_templates", {
      project_id: projectId,
      title: template.title,
      kind: template.kind,
      instruction: template.instruction,
      sort_order: index,
      created_at: now,
    });
  }

  for (const prompt of SAMPLE_PROMPTS) {
    await api.insert("prompts", {
      project_id: projectId,
      title: prompt.title,
      kind: prompt.kind,
      body: prompt.body,
      favorite: 0,
      notes: prompt.notes,
      created_at: now,
    });
  }

  const group = await api.insert<{ id: number }>("groups", {
    project_id: projectId,
    ...SAMPLE_GROUP,
    created_at: now,
  });

  await api.insert("posts", {
    project_id: projectId,
    title: "Dzisiaj: 5 minut ciszy",
    body: "Zanim cokolwiek zrobisz, daj sobie 5 minut ciszy. Usiądź, oddychaj, poczuj stopy na podłodze. Pięć minut to nie mało — to wystarczy.",
    kind: "page",
    status: "idea",
    group_id: null,
    notes: "Pomysł na post na stronę.",
    published_at: null,
    published_url: null,
    created_at: now,
    updated_at: now,
  });

  await api.insert("posts", {
    project_id: projectId,
    title: "Plan na głód — co zabrać ze sobą",
    body: "Zanim wyjdziesz z domu, spakuj: wodę, coś do przekąśnienia i jedno ćwiczenie na głód. Przetestuj to, zanim będzie naprawdę trudno.",
    kind: "group",
    status: "draft",
    group_id: Number(group.id),
    notes: "Wariant na grupę.",
    published_at: null,
    published_url: null,
    created_at: now,
    updated_at: now,
  });

  await api.insert("settings", {
    key: "media_categories",
    value: JSON.stringify(DEFAULT_MEDIA_CATEGORIES),
  });
}
