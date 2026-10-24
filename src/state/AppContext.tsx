import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createDataApi, type DataApi } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";
import { loadWorkspace, getSetting, setSetting, type Workspace } from "@/lib/repo";
import { DEFAULT_MEDIA_CATEGORIES } from "@/types";
import { Icon } from "@/components/icons";

export type SectionId = "brief" | "posts" | "groups" | "media" | "prompts" | "settings";
export type ToastKind = "ok" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface AppContextValue {
  api: DataApi | null;
  workspace: Workspace;
  loading: boolean;
  error: string | null;
  section: SectionId;
  setSection: (section: SectionId) => void;
  activeProjectId: number | null;
  setActiveProject: (id: number) => void;
  selectedGroupId: number | null;
  setSelectedGroupId: (id: number | null) => void;
  refresh: () => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
  newItemNonce: number;
  requestNewItem: () => void;
  consumeNewItem: () => boolean;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  mediaCategories: string[];
  saveMediaCategories: (categories: string[]) => Promise<void>;
}

const emptyWorkspace: Workspace = {
  projects: [],
  platforms: [],
  project: null,
  brief: null,
  groups: [],
  posts: [],
  media: [],
  prompts: [],
  templates: [],
  tags: [],
  publications: [],
};

const AppContext = createContext<AppContextValue | null>(null);

const ACTIVE_PROJECT_KEY = "socialhq.activeProject";

export function AppProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<DataApi | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("brief");
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [newItemNonce, setNewItemNonce] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mediaCategories, setMediaCategories] = useState<string[]>(DEFAULT_MEDIA_CATEGORIES);
  const toastId = useRef(0);

  const toast = useCallback((message: string, kind: ToastKind = "ok") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
      const projects = await api.all<{ id: number }>("projects");
      const preferred =
        activeProjectId ??
        (stored ? Number(stored) : null) ??
        (projects[0]?.id ?? null);
      const next = await loadWorkspace(api, preferred);
      setWorkspace(next);
      setActiveProjectId(next.project?.id ?? null);
      if (next.project?.id) localStorage.setItem(ACTIVE_PROJECT_KEY, String(next.project.id));

      const categories = await getSetting(api, "media_categories");
      if (categories) {
        try {
          const parsed = JSON.parse(categories) as string[];
          if (Array.isArray(parsed) && parsed.length > 0) setMediaCategories(parsed);
        } catch {
          /* keep defaults */
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nieznany błąd danych.");
    }
  }, [api, activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instance = createDataApi();
        await instance.init();
        await ensureSeed(instance);
        if (cancelled) return;
        setApi(instance);
        setLoading(false);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Nie udało się przygotować bazy danych.",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (api) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const setActiveProject = useCallback(
    (id: number) => {
      setActiveProjectId(id);
      localStorage.setItem(ACTIVE_PROJECT_KEY, String(id));
      setSelectedGroupId(null);
      void refresh();
    },
    [refresh],
  );

  const pendingNewItem = useRef(false);
  const requestNewItem = useCallback(() => {
    pendingNewItem.current = true;
    setNewItemNonce((value) => value + 1);
  }, []);
  const consumeNewItem = useCallback(() => {
    if (!pendingNewItem.current) return false;
    pendingNewItem.current = false;
    return true;
  }, []);

  const saveMediaCategories = useCallback(
    async (categories: string[]) => {
      setMediaCategories(categories);
      if (!api) return;
      await setSetting(api, "media_categories", JSON.stringify(categories));
    },
    [api],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      api,
      workspace,
      loading,
      error,
      section,
      setSection,
      activeProjectId,
      setActiveProject,
      selectedGroupId,
      setSelectedGroupId,
      refresh,
      toast,
      newItemNonce,
      requestNewItem,
      consumeNewItem,
      paletteOpen,
      setPaletteOpen,
      mediaCategories,
      saveMediaCategories,
    }),
    [
      api,
      workspace,
      loading,
      error,
      section,
      activeProjectId,
      setActiveProject,
      selectedGroupId,
      refresh,
      toast,
      newItemNonce,
      requestNewItem,
      consumeNewItem,
      paletteOpen,
      mediaCategories,
      saveMediaCategories,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} />
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp musi być użyty wewnątrz AppProvider.");
  return context;
}

function Toaster({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cnToast(item.kind)}
        >
          <Icon
            name={item.kind === "error" ? "alert" : item.kind === "info" ? "info" : "check"}
            size={15}
          />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}

function cnToast(kind: ToastKind): string {
  const base =
    "pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-[13px] shadow-xl shadow-black/50 backdrop-blur-md animate-fade-up";
  if (kind === "error") return `${base} border-danger/30 bg-danger/15 text-danger`;
  if (kind === "info") return `${base} border-info/30 bg-info/15 text-info`;
  return `${base} border-accent/25 bg-accent/12 text-accent`;
}
