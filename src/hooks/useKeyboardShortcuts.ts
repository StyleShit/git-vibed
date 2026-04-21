import { useEffect } from "react";
import { useRepo } from "../stores/repo";
import { useUI } from "../stores/ui";
import { useSettings } from "../stores/settings";
import { unwrap } from "../lib/ipc";

export function useKeyboardShortcuts() {
  const toast = useUI((s) => s.toast);
  const pullStrategy = useSettings((s) => s.defaultPullStrategy);

  useEffect(() => {
    async function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const { repoPath, status } = useRepo.getState();
      if (!repoPath) return;

      // Cmd/Ctrl + Enter — commit (only if a message box has text). Delegated
      // to the commit panel which owns the input state.
      if (e.key === "Enter") {
        const evt = new CustomEvent("gitgui:commit");
        window.dispatchEvent(evt);
        e.preventDefault();
        return;
      }

      if (e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        try {
          await unwrap(
            window.gitApi.push({
              remote: status?.tracking?.split("/")[0],
              branch: status?.branch ?? undefined,
              setUpstream: !status?.tracking,
            }),
          );
          toast("success", "Pushed");
        } catch (err) {
          toast("error", `Push failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        try {
          await unwrap(window.gitApi.pull({ strategy: pullStrategy }));
          toast("success", "Pulled");
        } catch (err) {
          toast("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        try {
          await unwrap(window.gitApi.fetch({ all: true, prune: true }));
          toast("success", "Fetched");
        } catch (err) {
          toast("error", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toast, pullStrategy]);
}
