import { create } from "zustand";

export type MainView = "graph" | "changes" | "remotes" | "settings" | "prs" | "pr-detail" | "merge";

interface Toast {
  id: string;
  kind: "error" | "info" | "success";
  text: string;
}

export interface GraphColumns {
  refs: boolean;
  message: boolean;
  author: boolean;
  date: boolean;
  sha: boolean;
}

// Commit-file selection opens an inline diff view inside the graph main
// panel. Kept in the UI store so it survives across re-renders of the
// CommitDetail sidebar.
export interface CommitFileSelection {
  hash: string;
  path: string;
}

// WIP file selection: staged vs unstaged matters because the diff IPC needs
// to know which side of the index to compare against.
export interface WipFileSelection {
  path: string;
  staged: boolean;
}

interface UIState {
  view: MainView;
  selectedCommit: string | null;
  selectedFile: string | null;
  selectedPR: number | null;
  selectedStash: number | null;
  selectedCommitFile: CommitFileSelection | null;
  selectedWipFile: WipFileSelection | null;
  selectedConflictFile: string | null;
  prStateFilter: "open" | "closed" | "all";
  commandPaletteOpen: boolean;
  hoveredBranch: string | null;
  graphColumns: GraphColumns;
  toasts: Toast[];
  setView: (v: MainView) => void;
  selectCommit: (hash: string | null) => void;
  selectFile: (p: string | null) => void;
  selectPR: (n: number | null) => void;
  selectStash: (index: number | null) => void;
  selectCommitFile: (f: CommitFileSelection | null) => void;
  selectWipFile: (f: WipFileSelection | null) => void;
  selectConflictFile: (p: string | null) => void;
  setPrStateFilter: (s: UIState["prStateFilter"]) => void;
  setCommandPalette: (open: boolean) => void;
  setHoveredBranch: (b: string | null) => void;
  setGraphColumn: (k: keyof GraphColumns, v: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
}

const DEFAULT_COLUMNS: GraphColumns = {
  refs: true,
  message: true,
  author: true,
  date: true,
  sha: true,
};

export const useUI = create<UIState>((set, get) => ({
  view: "graph",
  selectedCommit: null,
  selectedFile: null,
  selectedPR: null,
  selectedStash: null,
  selectedCommitFile: null,
  selectedWipFile: null,
  selectedConflictFile: null,
  prStateFilter: "open",
  commandPaletteOpen: false,
  hoveredBranch: null,
  graphColumns: DEFAULT_COLUMNS,
  toasts: [],
  setView: (view) => set({ view }),
  // Selecting a commit clears stash selection (and vice versa) — the right
  // inspector only shows one thing at a time.
  selectCommit: (selectedCommit) =>
    set({
      selectedCommit,
      selectedStash: null,
      selectedCommitFile: null,
      selectedWipFile: null,
    }),
  selectFile: (selectedFile) => set({ selectedFile }),
  selectPR: (selectedPR) =>
    set((s) => {
      if (selectedPR == null) {
        return { selectedPR: null, view: s.view === "pr-detail" ? "graph" : s.view };
      }
      return { selectedPR, view: "pr-detail" };
    }),
  selectStash: (selectedStash) =>
    set({
      selectedStash,
      selectedCommit: null,
      selectedCommitFile: null,
      selectedWipFile: null,
    }),
  selectCommitFile: (selectedCommitFile) =>
    set({ selectedCommitFile, selectedWipFile: null }),
  selectWipFile: (selectedWipFile) =>
    set({
      selectedWipFile,
      selectedCommit: null,
      selectedStash: null,
      selectedCommitFile: null,
    }),
  selectConflictFile: (selectedConflictFile) => set({ selectedConflictFile }),
  setPrStateFilter: (prStateFilter) => set({ prStateFilter }),
  setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setHoveredBranch: (hoveredBranch) => set({ hoveredBranch }),
  setGraphColumn: (k, v) =>
    set((s) => ({ graphColumns: { ...s.graphColumns, [k]: v } })),
  toast: (kind, text) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
