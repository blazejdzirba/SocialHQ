import { useEffect, useState } from "react";
import { useApp } from "@/state/AppContext";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { createProject, updateProject } from "@/lib/repo";
import type { Project } from "@/types";

const PRESET_COLORS = ["#BFEF00", "#7CB8FF", "#FF8A5B", "#E1306C", "#25F4EE", "#8B98A5"];

export function ProjectDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
}) {
  const { api, workspace, toast, refresh, setActiveProject } = useApp();
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("facebook");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#BFEF00");

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setPlatform(project?.platform ?? workspace.platforms[0]?.id ?? "facebook");
    setUrl(project?.url ?? "");
    setColor(project?.color ?? "#BFEF00");
  }, [open, project, workspace.platforms]);

  const save = async () => {
    if (!api) return;
    if (!name.trim()) {
      toast("Nazwa projektu jest wymagana.", "error");
      return;
    }
    try {
      if (project) {
        await updateProject(api, project.id, {
          name: name.trim(),
          platform,
          url: url.trim() || null,
          color,
        });
        toast("Projekt zaktualizowany.");
      } else {
        const created = await createProject(api, {
          name: name.trim(),
          platform,
          url: url.trim(),
          color,
        });
        await refresh();
        setActiveProject(created.id);
        toast("Projekt dodany.");
      }
      await refresh();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie udało się zapisać projektu.", "error");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edytuj projekt" : "Nowy projekt"}
      description="Fanpage, marka albo profil — każdy projekt ma własny brief i materiały."
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
        <Field label="Nazwa projektu" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="np. SobieBro"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Platforma" hint="Lista jest rozszerzalna.">
            <Select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              options={workspace.platforms.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
            />
          </Field>
          <Field label="Adres strony">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.facebook.com/…"
            />
          </Field>
        </div>
        <Field label="Kolor projektu">
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                className="h-7 w-7 rounded-lg border-2 transition-transform hover:scale-110"
                style={{
                  background: preset,
                  borderColor: color === preset ? "#ffffff" : "transparent",
                }}
                aria-label={`Wybierz kolor ${preset}`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-7 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
              aria-label="Własny kolor"
            />
          </div>
        </Field>
      </div>
    </Modal>
  );
}
