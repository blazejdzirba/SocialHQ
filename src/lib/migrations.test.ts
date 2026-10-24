import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationFile = resolve(process.cwd(), "src-tauri/src/migrations.sql");

interface Migration {
  version: number;
  sql: string;
}

function parseMigrations(source: string): Migration[] {
  const blocks: Migration[] = [];
  let current: Migration | null = null;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    const marker = trimmed.match(/^--\s*migration:\s*(\d+)$/);
    if (marker) {
      if (current) blocks.push(current);
      current = { version: Number(marker[1]), sql: "" };
      continue;
    }
    if (current) current.sql += `${line}\n`;
  }
  if (current) blocks.push(current);
  return blocks;
}

const migrations = parseMigrations(readFileSync(migrationFile, "utf8"));

describe("migracje schematu", () => {
  it(" zawiera numerowane bloki migracji", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    expect(migrations.every((migration) => migration.version > 0)).toBe(true);
  });

  it("utrzymuje kolejne, unikalne numery wersji", () => {
    const versions = migrations.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    versions.forEach((version, index) => {
      if (index > 0) expect(version).toBeGreaterThan(versions[index - 1]);
    });
  });

  it("tworzy wszystkie tabele z modelu danych", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");
    const tables = [
      "projects",
      "project_briefs",
      "task_templates",
      "posts",
      "post_media",
      "groups",
      "group_publications",
      "group_tags",
      "media",
      "tags",
      "prompts",
      "prompt_tags",
      "settings",
      "platforms",
    ];
    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("tworzy indeksy pod wyszukiwanie i filtrowanie", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_posts_project");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_posts_status");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_media_sha");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_publications_group");
  });

  it("zawiera indeks tekstowy FTS5 z wyzwalaczami", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");
    expect(sql).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS posts_fts_ai");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS groups_fts_ai");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS prompts_fts_ai");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS media_fts_ai");
  });

  it("używa kluczy obcych kaskadowych", () => {
    const sql = migrations.map((migration) => migration.sql).join("\n");
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES projects(id)");
  });
});
