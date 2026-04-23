import { create } from "zustand";

export type MainView = "graph" | "changes" | "remotes" | "settings" | "prs" | "pr-detail" | "merge";

interface Toast {
  id: string;
  kind: "error" | "info" | "success";
  text: string;
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

// Stash file selection mirrors CommitFileSelection — index pins the stash
// entry, path pins the file within it. Rendering this pair swaps the main
// view into a dedicated diff component.
export interface StashFileSelection {
  index: number;
  path: string;
}

interface UIState {
  view: MainView;
  selectedCommit: string | null;
  selectedFile: string | null;
  selectedPR: number | null;
  selectedStash: number | null;
  selectedCommitFile: CommitFileSelection | null;
  selectedWipFile: WipFileSelection | null;
  selectedStashFile: StashFileSelection | null;
  selectedConflictFile: string | null;
  commandPaletteOpen: boolean;
  welcomeOpen: boolean;
  hoveredBranch: string | null;
  toasts: Toast[];
  setView: (v: MainView) => void;
  selectCommit: (hash: string | null) => void;
  selectFile: (p: string | null) => void;
  selectPR: (n: number | null) => void;
  selectStash: (index: number | null) => void;
  selectCommitFile: (f: CommitFileSelection | null) => void;
  selectWipFile: (f: WipFileSelection | null) => void;
  selectStashFile: (f: StashFileSelection | null) => void;
  selectConflictFile: (p: string | null) => void;
  setCommandPalette: (open: boolean) => void;
  setWelcomeOpen: (open: boolean) => void;
  setHoveredBranch: (b: string | null) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  view: "graph",
  selectedCommit: null,
  selectedFile: null,
  selectedPR: null,
  selectedStash: null,
  selectedCommitFile: null,
  selectedWipFile: null,
  selectedStashFile: null,
  selectedConflictFile: null,
  commandPaletteOpen: false,
  welcomeOpen: false,
  hoveredBranch: null,
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
      selectedStashFile: null,
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
    set((s) => ({
      selectedStash,
      selectedCommit: null,
      selectedCommitFile: null,
      selectedWipFile: null,
      // Don't eagerly clear the stash file — keeping the previous one
      // referenced means StashFileDiff stays mounted with its old
      // content during the click-to-load gap, and StashDetail's
      // auto-select swaps in the new stash's first file as soon as
      // the file list resolves. Clearing to null fell through to the
      // graph view, which the user saw as a flash on every switch.
      // When unselecting (null) we do clear, same as before.
      selectedStashFile:
        selectedStash == null ? null : s.selectedStashFile,
    })),
  selectCommitFile: (selectedCommitFile) =>
    set({ selectedCommitFile, selectedWipFile: null, selectedStashFile: null }),
  selectWipFile: (selectedWipFile) =>
    set({
      selectedWipFile,
      selectedCommit: null,
      selectedStash: null,
      selectedCommitFile: null,
      selectedStashFile: null,
    }),
  selectStashFile: (selectedStashFile) =>
    set({ selectedStashFile, selectedCommitFile: null, selectedWipFile: null }),
  selectConflictFile: (selectedConflictFile) => set({ selectedConflictFile }),
  setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
  setHoveredBranch: (hoveredBranch) => set({ hoveredBranch }),
  toast: (kind, text) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
