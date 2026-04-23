import { create } from "zustand";
import { persist } from "zustand/middleware";

type BranchKind = "local" | "remote";
type SidebarSectionId =
  | "local"
  | "remote"
  | "stashes"
  | "worktrees"
  | "prs"
  | "tags";

export interface GraphColumns {
  refs: boolean;
  message: boolean;
  author: boolean;
  date: boolean;
  sha: boolean;
}

interface SettingsState {
  theme: "dark" | "light" | "system";
  autoFetchIntervalMs: number;
  defaultPullStrategy: "merge" | "rebase" | "ff-only";
  skipHooksByDefault: boolean;
  diffViewMode: "unified" | "split";
  // Path vs. tree layout for any file list (staging panel, commit detail,
  // stash detail). Shared so toggling it in one place sticks everywhere.
  fileListViewMode: "path" | "tree";
  // Persisted panel widths. Defaults are conservative so the graph column
  // still gets most of the screen on typical 1280-wide displays.
  sidebarWidth: number;
  inspectorWidth: number;
  // Which sidebar sections are collapsed (Local, Remote, Stashes, …).
  // Kept as arrays in the persisted shape so JSON serialization is trivial;
  // consumers convert to Set<string> at read time.
  collapsedSidebarSections: SidebarSectionId[];
  // Collapsed folder paths inside Local / Remote branch trees. Keyed by the
  // branch list kind, value is an array of folder paths (e.g. "feature/auth").
  // Using folder paths rather than repo-scoped keys means "feature/" stays
  // collapsed across repos, which matches how other clients like VSCode
  // behave and keeps the state file small.
  collapsedBranchFolders: Record<BranchKind, string[]>;
  // Graph column visibility toggles from the gear menu. Persisted so a user
  // who hides SHA/date once doesn't have to re-hide them on every launch.
  graphColumns: GraphColumns;
  // PR list filter (open/closed/all). The user's last choice is usually
  // the one they want next time the app opens.
  prStateFilter: "open" | "closed" | "all";
  setTheme: (t: SettingsState["theme"]) => void;
  setAutoFetchIntervalMs: (ms: number) => void;
  setDefaultPullStrategy: (s: SettingsState["defaultPullStrategy"]) => void;
  setSkipHooksByDefault: (v: boolean) => void;
  setDiffViewMode: (m: SettingsState["diffViewMode"]) => void;
  setFileListViewMode: (m: SettingsState["fileListViewMode"]) => void;
  setSidebarWidth: (w: number) => void;
  setInspectorWidth: (w: number) => void;
  setCollapsedSidebarSections: (ids: SidebarSectionId[]) => void;
  setCollapsedBranchFolders: (kind: BranchKind, paths: string[]) => void;
  setGraphColumn: (k: keyof GraphColumns, v: boolean) => void;
  setPrStateFilter: (s: SettingsState["prStateFilter"]) => void;
}

const DEFAULT_GRAPH_COLUMNS: GraphColumns = {
  refs: true,
  message: true,
  author: true,
  date: true,
  sha: true,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      autoFetchIntervalMs: 5 * 60 * 1000,
      defaultPullStrategy: "merge",
      skipHooksByDefault: false,
      diffViewMode: "unified",
      fileListViewMode: "path",
      sidebarWidth: 288,
      inspectorWidth: 352,
      // Match the previous in-memory default so existing users still open
      // with Tags collapsed on first run after the upgrade.
      collapsedSidebarSections: ["tags"],
      collapsedBranchFolders: { local: [], remote: [] },
      graphColumns: DEFAULT_GRAPH_COLUMNS,
      prStateFilter: "open",
      setTheme: (theme) => set({ theme }),
      setAutoFetchIntervalMs: (autoFetchIntervalMs) =>
        set({ autoFetchIntervalMs }),
      setDefaultPullStrategy: (defaultPullStrategy) =>
        set({ defaultPullStrategy }),
      setSkipHooksByDefault: (skipHooksByDefault) =>
        set({ skipHooksByDefault }),
      setDiffViewMode: (diffViewMode) => set({ diffViewMode }),
      setFileListViewMode: (fileListViewMode) => set({ fileListViewMode }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: Math.max(200, Math.min(600, sidebarWidth)) }),
      setInspectorWidth: (inspectorWidth) =>
        set({ inspectorWidth: Math.max(260, Math.min(640, inspectorWidth)) }),
      setCollapsedSidebarSections: (collapsedSidebarSections) =>
        set({ collapsedSidebarSections }),
      setCollapsedBranchFolders: (kind, paths) =>
        set((s) => ({
          collapsedBranchFolders: {
            ...s.collapsedBranchFolders,
            [kind]: paths,
          },
        })),
      setGraphColumn: (k, v) =>
        set((s) => ({ graphColumns: { ...s.graphColumns, [k]: v } })),
      setPrStateFilter: (prStateFilter) => set({ prStateFilter }),
    }),
    { name: "Git Vibed-settings" }
  )
);
