import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { Icon, type IconName } from "./icons";
import { Button, IconButton, KeyboardHint } from "./ui";
import { useApp, type SectionId } from "@/state/AppContext";

export const SECTION_META: Record<
  SectionId,
  { title: string; subtitle: string; icon: IconName; newLabel: string }
> = {
  brief: {
    title: "Opis projektu",
    subtitle: "Brief, zasady i gotowy pakiet kontekstowy dla agenta AI.",
    icon: "brief",
    newLabel: "Nowy pomysł",
  },
  posts: {
    title: "Pomysły i treści",
    subtitle: "Od szkicowego pomysłu do treści gotowej do wklejenia.",
    icon: "idea",
    newLabel: "Nowy pomysł",
  },
  groups: {
    title: "Grupy",
    subtitle: "Grupy, ich zasady oraz historia tego, co do nich wrzucaliśmy.",
    icon: "group",
    newLabel: "Nowa grupa",
  },
  media: {
    title: "Biblioteka zdjęć",
    subtitle: "Grafiki i zdjęcia lokalnie, z miniaturami i tagami.",
    icon: "image",
    newLabel: "Wgraj zdjęcia",
  },
  prompts: {
    title: "Biblioteka promptów",
    subtitle: "Szablony tekstowe i graficzne ze zmiennymi {{nazwa}}.",
    icon: "wand",
    newLabel: "Nowy prompt",
  },
  settings: {
    title: "Ustawienia i dane",
    subtitle: "Ścieżki danych, kopie zapasowe oraz eksport i import.",
    icon: "settings",
    newLabel: "",
  },
};

interface NavItem {
  section: SectionId;
  label: string;
  icon: IconName;
  badge?: number;
}

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: "planowanie",
    label: "Planowanie",
    items: [
      { section: "brief", label: "Opis projektu", icon: "brief" },
      { section: "posts", label: "Pomysły i treści", icon: "idea" },
    ],
  },
  {
    id: "spolecznosc",
    label: "Społeczność",
    items: [{ section: "groups", label: "Grupy", icon: "group" }],
  },
  {
    id: "materialy",
    label: "Materiały",
    items: [
      { section: "media", label: "Zdjęcia", icon: "image" },
      { section: "prompts", label: "Prompty", icon: "wand" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [{ section: "settings", label: "Ustawienia", icon: "settings" }],
  },
];

const COLLAPSE_KEY = "socialhq.navCollapsed";

export function Sidebar({ onCreateProject }: { onCreateProject: () => void }) {
  const { workspace, section, setSection, setPaletteOpen, api, setActiveProject } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const counts: Record<SectionId, number> = {
    brief: 0,
    posts: workspace.posts.length,
    groups: workspace.groups.length,
    media: workspace.media.length,
    prompts: workspace.prompts.length,
    settings: 0,
  };

  const platformLabel = (id: string) =>
    workspace.platforms.find((platform) => platform.id === id)?.label ?? id;

  return (
    <aside className="flex h-screen w-[268px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0e0d]/80 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-[#0b0f0e] shadow-[0_0_24px_-6px_rgba(191,239,0,0.8)]">
          <Icon name="brand" size={17} />
        </div>
        <div className="leading-tight">
          <div className="caps text-fg">SocialHQ</div>
          <div className="text-[10.5px] text-faint">centrum dowodzenia</div>
        </div>
      </div>

      <div className="px-3">
        <div ref={switcherRef} className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.07]"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: workspace.project?.color ?? "#BFEF00" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">
                {workspace.project?.name ?? "Brak projektu"}
              </span>
              <span className="block truncate text-[10.5px] text-faint">
                {workspace.project
                  ? platformLabel(workspace.project.platform)
                  : "wybierz projekt"}
              </span>
            </span>
            <Icon
              name="chevronDown"
              size={15}
              className={cn("text-faint transition-transform", switcherOpen && "rotate-180")}
            />
          </button>

          {switcherOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-white/10 bg-[#101614] shadow-2xl shadow-black/60">
              {workspace.projects.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-faint">Brak projektów.</p>
              ) : null}
              {workspace.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setSwitcherOpen(false);
                    setActiveProject(project.id);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: project.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-fg">{project.name}</span>
                    <span className="block truncate text-[10.5px] text-faint">
                      {platformLabel(project.platform)}
                    </span>
                  </span>
                  {project.id === workspace.project?.id ? (
                    <Icon name="check" size={14} className="text-accent" />
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSwitcherOpen(false);
                  onCreateProject();
                }}
                className="flex w-full items-center gap-2 border-t border-white/[0.07] px-3 py-2.5 text-[12px] text-accent transition-colors hover:bg-accent/10"
              >
                <Icon name="plus" size={14} /> Nowy projekt
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="scroll-thin mt-5 flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const isCollapsed = collapsed[group.id];
          return (
            <div key={group.id} className="mb-4">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="group mb-1 flex w-full items-center gap-1.5 px-2 py-1 text-left"
              >
                <Icon
                  name="chevronRight"
                  size={12}
                  className={cn("text-faint transition-transform", !isCollapsed && "rotate-90")}
                />
                <span className="caps text-faint group-hover:text-muted">{group.label}</span>
              </button>

              {!isCollapsed ? (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = section === item.section;
                    return (
                      <button
                        key={item.section}
                        type="button"
                        onClick={() => setSection(item.section)}
                        className={cn(
                          "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                          active
                            ? "bg-accent/12 text-accent"
                            : "text-muted hover:bg-white/[0.05] hover:text-fg",
                        )}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
                        ) : null}
                        <Icon name={item.icon} size={16} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {counts[item.section] > 0 ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              active ? "bg-accent/20 text-accent" : "bg-white/[0.06] text-faint",
                            )}
                          >
                            {counts[item.section]}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[12px] text-muted transition-colors hover:border-white/20 hover:text-fg"
        >
          <Icon name="search" size={14} />
          <span className="flex-1">Szukaj wszędzie</span>
          <KeyboardHint keys={["Ctrl", "K"]} />
        </button>
        <div className="mt-2 flex items-center justify-between px-1 text-[10.5px] text-faint">
          <span className="truncate">
            {api?.backend === "tauri" ? "dane lokalne · SQLite" : "tryb przeglądarki"}
          </span>
          <span className="flex items-center gap-1">
            <Icon name="shield" size={11} /> offline
          </span>
        </div>
      </div>
    </aside>
  );
}

export function TopBar() {
  const { section, requestNewItem, workspace } = useApp();
  const meta = SECTION_META[section];

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.06] bg-[#080b0a]/85 px-6 py-4 backdrop-blur-xl">
      <div className="min-w-0">
        <h1 className="caps text-[12px] text-fg">{meta.title}</h1>
        <p className="mt-1 truncate text-[12.5px] text-faint">
          {meta.subtitle}
          {workspace.project ? (
            <span className="text-faint/70"> · {workspace.project.name}</span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {meta.newLabel ? (
          <Button variant="primary" icon="plus" onClick={requestNewItem}>
            {meta.newLabel}
          </Button>
        ) : null}
        <IconButton icon="search" label="Szukaj" onClick={() => useAppSetPalette()} />
      </div>
    </header>
  );
}

function useAppSetPalette() {
  // Small helper so the icon button can open the palette without prop drilling.
  const { setPaletteOpen } = useApp();
  setPaletteOpen(true);
}
