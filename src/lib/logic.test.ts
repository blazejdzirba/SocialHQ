import { describe, expect, it } from "vitest";
import {
  briefVariables,
  buildContextPack,
  estimateTokens,
  extractVariables,
  fillTemplate,
  findSimilar,
  jaccard,
  normalizeText,
  quickTaskInstruction,
  similarity,
  tokenize,
} from "./logic";
import type { Brief, Group, GroupPublication, Project } from "@/types";

const project: Project = {
  id: 1,
  name: "SoberBro",
  platform: "facebook",
  url: "https://facebook.com/soberbro",
  color: "#BFEF00",
  icon: null,
  created_at: "2026-01-01T10:00:00.000Z",
};

const brief: Brief = {
  project_id: 1,
  about: "Polska aplikacja wspierająca osoby w trzeźwości.",
  audience: "Dorośli Polacy walczący z uzależnieniem.",
  tone: "Ciepły, spokojny, na „Ty”.",
  avoid: "Bez moralizowania i straszenia.",
  rules: "Przy kryzysie dzwonić na 112.",
  fixed_elements: "Nazwa: SoberBro. CTA: policz swój pierwszy dzień.",
  extra_context: "Anonimowa i darmowa.",
  visual_guidelines: "Mgliste góry, zieleń i limonkowy akcent.",
  updated_at: "2026-01-01T10:00:00.000Z",
};

const group: Group = {
  id: 7,
  project_id: 1,
  name: "Grupa wsparcia",
  url: "https://facebook.com/groups/wsparcie",
  topic: "Codzienna trzeźwość",
  members: 1200,
  rules: "Zakaz linków do sklepów.",
  notes: "Najlepiej reaguje na ćwiczenia.",
  pinned: 1,
  created_at: "2026-01-01T10:00:00.000Z",
};

describe("similarity", () => {
  it("normalizes text by folding diacritics and punctuation", () => {
    expect(normalizeText("Zażółć gęślą jaźń!")).toBe("zazolc gesla jazn");
  });

  it("tokenizes into unique words", () => {
    expect(tokenize("dzień dobry dzień")).toEqual(["dzien", "dobry"]);
  });

  it("returns 1 for identical token sets", () => {
    expect(jaccard(["a", "b"], ["b", "a"])).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("detects similar posts", () => {
    const score = similarity(
      "Dzisiaj daj sobie pięć minut ciszy przed wyjściem z domu.",
      "Pięć minut ciszy dzisiaj, zanim wyjdziesz z domu.",
    );
    expect(score).toBeGreaterThan(0.2);
  });

  it("finds and ranks similar candidates above the threshold", () => {
    const matches = findSimilar(
      "Dzisiaj daj sobie pięć minut ciszy przed wyjściem",
      [
        { id: 1, body: "Pięć minut ciszy zanim wyjdziesz z domu" },
        { id: 2, body: "Nowy przepis na ciasto czekoladowe" },
      ],
      0.2,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(1);
    expect(matches[0].score).toBeGreaterThan(0.2);
  });

  it("ignores empty input", () => {
    expect(findSimilar("", [{ id: 1, body: "cokolwiek" }])).toHaveLength(0);
  });
});

describe("prompt variables", () => {
  it("extracts unique variables", () => {
    expect(extractVariables("{{temat}} oraz {{temat}} i {{brief.ton}}")).toEqual([
      "temat",
      "brief.ton",
    ]);
  });

  it("fills variables and keeps unknown placeholders", () => {
    const result = fillTemplate("Temat: {{temat}} / {{nieznane}}", { temat: "głód" });
    expect(result).toBe("Temat: głód / {{nieznane}}");
  });

  it("exposes brief fields as variables", () => {
    const values = briefVariables(brief, project);
    expect(values["brief.ton"]).toBe(brief.tone);
    expect(values.projekt).toBe("SoberBro");
  });
});

describe("context pack", () => {
  it("assembles all brief sections", () => {
    const pack = buildContextPack({ project, brief, platformLabel: "Facebook" });
    expect(pack).toContain("# PAKIET KONTEKSTOWY — SoberBro");
    expect(pack).toContain("Platforma: Facebook");
    expect(pack).toContain("## 1. Czym jest projekt");
    expect(pack).toContain(brief.about);
    expect(pack).toContain(brief.visual_guidelines);
  });

  it("skips empty sections", () => {
    const pack = buildContextPack({
      project,
      brief: { ...brief, extra_context: "", rules: "   " },
    });
    expect(pack).not.toContain("Dodatkowy kontekst");
    expect(pack).not.toContain("Zasady i ograniczenia");
  });

  it("adds the target group with rules and previous publications", () => {
    const publications: GroupPublication[] = [
      {
        id: 1,
        group_id: 7,
        post_id: null,
        body_snapshot: "Wczoraj wrzuciliśmy post o oddechu.",
        published_at: "2026-02-01T12:00:00.000Z",
        post_url: null,
        outcome_note: null,
      },
    ];
    const pack = buildContextPack({ project, brief, group, publications });
    expect(pack).toContain("Grupa docelowa");
    expect(pack).toContain("Zakaz linków do sklepów.");
    expect(pack).toContain("Wczoraj wrzuciliśmy post o oddechu.");
  });

  it("appends the task instruction at the end", () => {
    const pack = buildContextPack({
      project,
      brief,
      instruction: "Napisz 3 propozycje posta.",
      instructionTitle: "Nowy post na stronę",
    });
    expect(pack).toContain("## ZADANIE — Nowy post na stronę");
    expect(pack).toContain("Napisz 3 propozycje posta.");
    expect(pack.indexOf("Napisz 3 propozycje posta.")).toBeGreaterThan(
      pack.indexOf("## 1. Czym jest projekt"),
    );
  });

  it("adds the group name to quick task instructions", () => {
    const instruction = quickTaskInstruction(
      { key: "group", title: "Post do grupy", kind: "text", instruction: "Napisz post." },
      group,
    );
    expect(instruction).toContain("Napisz post.");
    expect(instruction).toContain("Grupa docelowa: „Grupa wsparcia”.");
  });

  it("estimates tokens roughly by characters", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
