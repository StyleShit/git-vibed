import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  theme: "dark" | "light" | "system";
  autoFetchIntervalMs: number;
  defaultPullStrategy: "merge" | "rebase" | "ff-only";
  skipHooksByDefault: boolean;
  setTheme: (t: SettingsState["theme"]) => void;
  setAutoFetchIntervalMs: (ms: number) => void;
  setDefaultPullStrategy: (s: SettingsState["defaultPullStrategy"]) => void;
  setSkipHooksByDefault: (v: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      autoFetchIntervalMs: 5 * 60 * 1000,
      defaultPullStrategy: "merge",
      skipHooksByDefault: false,
      setTheme: (theme) => set({ theme }),
      setAutoFetchIntervalMs: (autoFetchIntervalMs) => set({ autoFetchIntervalMs }),
      setDefaultPullStrategy: (defaultPullStrategy) => set({ defaultPullStrategy }),
      setSkipHooksByDefault: (skipHooksByDefault) => set({ skipHooksByDefault }),
    }),
    { name: "git-gui-settings" },
  ),
);
