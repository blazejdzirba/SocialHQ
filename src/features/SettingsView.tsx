import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/state/AppContext";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  SectionLabel,
  TagInput,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { BackupEntry, DataPaths } from "@/types";

export function SettingsView() {
  const { api, workspace, toast, refresh, mediaCategories, saveMediaCategories } = useApp();
  const [paths, setPaths] = useState<DataPaths | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [confirmImport, setConfirmImport] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setPaths(await api.dataPaths());
      setBackups(await api.listBackups());
    } catch {
      /* ignore */
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportData = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.exportArchive();
      toast(`Eksport zakończony: ${result}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się wyeksportować.", "error");
    } finally {
      setBusy(false);
    }
  };

  const importData = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const source = await api.pickArchive();
      if (!source) {
        setBusy(false);
        return;
      }
      await api.importArchive(source);
      await refresh();
      await load();
      toast("Dane zostały przywrócone z archiwum.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zaimportować.", "error");
    } finally {
      setBusy(false);
      setConfirmImport(false);
    }
  };

  const createBackup = async () => {
    if (!api) return;
    try {
      const path = await api.createBackup();
      await load();
      toast(`Kopia zapasowa utworzona: ${path}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się utworzyć kopii.", "error");
    }
  };

  const restoreBackup = async (backup: BackupEntry) => {
    if (!api?.restoreBackup) return;
    setBusy(true);
    try {
      await api.restoreBackup(backup.path);
      await refresh();
      await load();
      toast("Przywrócono dane z kopii zapasowej.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się przywrócić kopii.", "error");
    } finally {
      setBusy(false);
      setConfirmRestore(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel>Dane aplikacji</SectionLabel>
            <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-muted">
              Wszystko trzymamy lokalnie. Brak kont, chmury i telemetrii. Zdjęcia kopiujemy do
              folderu aplikacji, a w bazie zostają tylko metadane i ścieżki względne.
            </p>
          </div>
          <Badge tone={paths?.backend === "tauri" ? "accent" : "info"}>
            {paths?.backend === "tauri" ? "SQLite · desktop" : "podgląd w przeglądarce"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <PathRow label="Folder danych" value={paths?.root ?? "—"} />
          <PathRow label="Baza danych" value={paths?.database ?? "—"} />
          <PathRow label="Zdjęcia" value={paths?.media ?? "—"} />
          <PathRow label="Kopie zapasowe" value={paths?.backups ?? "—"} />
          <PathRow label="Eksporty" value={paths?.exports ?? "—"} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            icon="folder"
            onClick={async () => {
              if (!api) return;
              try {
                await api.openDataFolder();
              } catch (error) {
                toast(
                  error instanceof Error ? error.message : "Nie udało się otworzyć folderu.",
                  "error",
                );
              }
            }}
          >
            Otwórz folder danych
          </Button>
          <Button icon="save" onClick={createBackup}>
            Utwórz kopię zapasową
          </Button>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionLabel className="mb-3">Eksport i import</SectionLabel>
          <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
            Eksport zapisuje bazę i wszystkie zdjęcia w jednym pliku ZIP. Import nadpisuje bieżące
            dane — przed importem tworzymy automatyczną kopię.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="download" loading={busy} onClick={exportData}>
              Eksportuj do ZIP
            </Button>
            <Button icon="upload" onClick={() => setConfirmImport(true)}>
              Importuj z ZIP
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionLabel>Kopie zapasowe</SectionLabel>
            <span className="text-[11px] text-faint">ostatnie 5</span>
          </div>
          {backups.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-muted">
              Brak kopii. Powstaje automatycznie przy zamknięciu aplikacji.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {backups.map((backup) => (
                <li
                  key={backup.name}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2"
                >
                  <Icon name="package" size={14} className="text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-fg">{backup.name}</p>
                    <p className="truncate text-[10.5px] text-faint">
                      {formatDateTime(backup.created_at)} · {formatBytes(backup.size)}
                    </p>
                  </div>
                  {api?.restoreBackup ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      icon="upload"
                      disabled={busy}
                      onClick={() => setConfirmRestore(backup)}
                    >
                      Przywróć
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionLabel className="mb-3">Kategorie zdjęć</SectionLabel>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Własne nazwy kategorii — używane w bibliotece zdjęć.
        </p>
        <div className="max-w-lg">
          <TagInput
            value={mediaCategories}
            onChange={(next) => {
              void saveMediaCategories(next);
            }}
            placeholder="np. do-postow"
          />
        </div>
      </Card>

      <Card>
        <SectionLabel className="mb-3">Platformy</SectionLabel>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Lista platform jest rozszerzalna — dodanie nowej nie wymaga zmiany schematu bazy.
        </p>
        <div className="flex flex-wrap gap-2">
          {workspace.platforms.map((platform) => (
            <span
              key={platform.id}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-fg"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: platform.color }}
                aria-hidden="true"
              />
              {platform.label}
            </span>
          ))}
        </div>
      </Card>

      <Card>
        <SectionLabel className="mb-3">O aplikacji</SectionLabel>
        <div className="grid gap-3 text-[12.5px] text-muted sm:grid-cols-2">
          <InfoRow label="Nazwa" value="SocialHQ" />
          <InfoRow label="Wersja" value="0.1.0" />
          <InfoRow label="Tryb" value={paths?.backend === "tauri" ? "Okno natywne (Tauri)" : "Podgląd"} />
          <InfoRow
            label="Projektów / grup / postów"
            value={`${workspace.projects.length} / ${workspace.groups.length} / ${workspace.posts.length}`}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={confirmRestore !== null}
        title="Przywrócić kopię zapasową?"
        message={
          confirmRestore
            ? `Bieżące dane zostaną zastąpione stanem z kopii „${confirmRestore.name}”. Kopia zostanie dodatkowo zabezpieczona przed przywróceniem.`
            : ""
        }
        confirmLabel="Przywróć"
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => (confirmRestore ? restoreBackup(confirmRestore) : Promise.resolve())}
      />

      <ConfirmDialog
        open={confirmImport}
        title="Zaimportować archiwum?"
        message="Bieżące dane zostaną nadpisane. Przed importem automatycznie tworzymy kopię zapasową."
        confirmLabel="Importuj"
        onCancel={() => setConfirmImport(false)}
        onConfirm={importData}
      />
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2">
      <div className="caps text-faint">{label}</div>
      <div className="mono mt-1 break-all text-[11.5px] text-fg">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
      <span className="text-faint">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}
