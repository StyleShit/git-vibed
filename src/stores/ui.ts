import { create } from "zustand";

export type MainView = "graph" | "changes" | "remotes" | "settings" | "prs" | "pr-detail" | "merge";

interface Toast {
  id: string;
  kind: "error" | "info" | "success";
  text: string;
}

interface UIState {
  view: MainView;
  selectedCommit: string | null;
  selectedFile: string | null;
  selectedPR: number | null;
  selectedConflictFile: string | null;
  prStateFilter: "open" | "closed" | "all";
  toasts: Toast[];
  setView: (v: MainView) => void;
  selectCommit: (hash: string | null) => void;
  selectFile: (p: string | null) => void;
  selectPR: (n: number | null) => void;
  selectConflictFile: (p: string | null) => void;
  setPrStateFilter: (s: UIState["prStateFilter"]) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  view: "graph",
  selectedCommit: null,
  selectedFile: null,
  selectedPR: null,
  selectedConflictFile: null,
  prStateFilter: "open",
  toasts: [],
  setView: (view) => set({ view }),
  selectCommit: (selectedCommit) => set({ selectedCommit }),
  selectFile: (selectedFile) => set({ selectedFile }),
  selectPR: (selectedPR) => set({ selectedPR, view: selectedPR == null ? get().view : "pr-detail" }),
  selectConflictFile: (selectedConflictFile) => set({ selectedConflictFile }),
  setPrStateFilter: (prStateFilter) => set({ prStateFilter }),
  toast: (kind, text) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
