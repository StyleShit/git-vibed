import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  theme: "dark" | "light" | "system";
  autoFetchIntervalMs: number;
  defaultPullStrategy: "merge" | "rebase" | "ff-only";
  skipHooksByDefault: boolean;
  diffViewMode: "unified" | "split";
  // Persisted panel widths. Defaults are conservative so the graph column
  // still gets most of the screen on typical 1280-wide displays.
  sidebarWidth: number;
  inspectorWidth: number;
  setTheme: (t: SettingsState["theme"]) => void;
  setAutoFetchIntervalMs: (ms: number) => void;
  setDefaultPullStrategy: (s: SettingsState["defaultPullStrategy"]) => void;
  setSkipHooksByDefault: (v: boolean) => void;
  setDiffViewMode: (m: SettingsState["diffViewMode"]) => void;
  setSidebarWidth: (w: number) => void;
  setInspectorWidth: (w: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      autoFetchIntervalMs: 5 * 60 * 1000,
      defaultPullStrategy: "merge",
      skipHooksByDefault: false,
      diffViewMode: "unified",
      sidebarWidth: 288,
      inspectorWidth: 352,
      setTheme: (theme) => set({ theme }),
      setAutoFetchIntervalMs: (autoFetchIntervalMs) => set({ autoFetchIntervalMs }),
      setDefaultPullStrategy: (defaultPullStrategy) => set({ defaultPullStrategy }),
      setSkipHooksByDefault: (skipHooksByDefault) => set({ skipHooksByDefault }),
      setDiffViewMode: (diffViewMode) => set({ diffViewMode }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: Math.max(200, Math.min(600, sidebarWidth)) }),
      setInspectorWidth: (inspectorWidth) =>
        set({ inspectorWidth: Math.max(260, Math.min(640, inspectorWidth)) }),
    }),
    { name: "git-gui-settings" },
  ),
);
