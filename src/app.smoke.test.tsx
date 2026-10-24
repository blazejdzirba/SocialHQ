import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

/**
 * Smoke test: uruchamia całą aplikację w pamięci (backend przeglądarki),
 * sprawdza zasianie projektu SoberBro i renderowanie pakietu kontekstowego.
 */
describe("SocialHQ — uruchomienie", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("startuje, zasija projekt SoberBro i pokazuje brief", async () => {
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getAllByText("SoberBro").length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    await waitFor(
      () => {
        expect(screen.getByText("Podgląd pakietu kontekstowego")).toBeTruthy();
      },
      { timeout: 8000 },
    );

    // Nawigacja w sidebarze.
    expect(screen.getByText("Pomysły i treści")).toBeTruthy();
    expect(screen.getByText("Prompty")).toBeTruthy();
    expect(screen.getByText("Zdjęcia")).toBeTruthy();
  }, 20000);

  it("wczytuje zasiany brief do formularza i podglądu", async () => {
    const { container } = render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("Podgląd pakietu kontekstowego")).toBeTruthy();
      },
      { timeout: 8000 },
    );

    // Formularz briefu.
    const textareas = Array.from(container.querySelectorAll("textarea"));
    const about = textareas[0]?.value ?? "";
    expect(about).toContain("SoberBro to polska, bezpłatna aplikacja");

    // Podgląd pakietu kontekstowego.
    const preview = container.querySelector("pre");
    expect(preview?.textContent ?? "").toContain("# PAKIET KONTEKSTOWY — SoberBro");
    expect(preview?.textContent ?? "").toContain("## 1. Czym jest projekt");
  }, 20000);
});
