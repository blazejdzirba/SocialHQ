import { useEffect, useState } from "react";
import { AppProvider, useApp } from "@/state/AppContext";
import { Sidebar, TopBar } from "@/components/layout";
import { CommandPalette } from "@/components/CommandPalette";
import { ProjectDialog } from "@/features/ProjectDialog";
import { BriefView } from "@/features/BriefView";
import { PostsView } from "@/features/PostsView";
import { GroupsView } from "@/features/GroupsView";
import { MediaView } from "@/features/MediaView";
import { PromptsView } from "@/features/PromptsView";
import { SettingsView } from "@/features/SettingsView";
import { Card, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { section, setSection, setPaletteOpen, requestNewItem, loading, error } = useApp();
  const [projectOpen, setProjectOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "c") {
        event.preventDefault();
        setSection("brief");
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("socialhq:copy-pack")),
          60,
        );
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "n") {
        event.preventDefault();
        requestNewItem();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, requestNewItem, setSection]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onCreateProject={() => setProjectOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[900px] px-6 py-6">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-24 text-muted">
                <Spinner className="text-accent" />
                <span className="text-[13px]">Przygotowuję bazę danych…</span>
              </div>
            ) : error ? (
              <Card className="border-danger/30">
                <div className="flex items-start gap-3">
                  <Icon name="alert" size={18} className="mt-0.5 text-danger" />
                  <div>
                    <p className="text-[13px] font-medium text-danger">Coś poszło nie tak</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{error}</p>
                  </div>
                </div>
              </Card>
            ) : (
              <SectionView section={section} />
            )}
          </div>
        </main>
      </div>

      <CommandPalette />
      <ProjectDialog open={projectOpen} onClose={() => setProjectOpen(false)} />
    </div>
  );
}

function SectionView({ section }: { section: string }) {
  switch (section) {
    case "posts":
      return <PostsView />;
    case "groups":
      return <GroupsView />;
    case "media":
      return <MediaView />;
    case "prompts":
      return <PromptsView />;
    case "settings":
      return <SettingsView />;
    default:
      return <BriefView />;
  }
}
