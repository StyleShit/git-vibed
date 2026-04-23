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
      // Escape clears whatever inspector selection is active, or closes
      // the settings view when no selection is active. Runs before the
      // modifier-guarded branch below since Esc is never modified.
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        // Don't hijack Esc out of a text input — the user may be bailing
        // out of a filter field or dialog.
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        const ui = useUI.getState();
        const hadSelection =
          ui.selectedCommit != null ||
          ui.selectedStash != null ||
          ui.selectedCommitFile != null ||
          ui.selectedWipFile != null ||
          ui.selectedStashFile != null;
        if (hadSelection) {
          e.preventDefault();
          ui.selectCommit(null);
          ui.selectStash(null);
          ui.selectCommitFile(null);
          ui.selectWipFile(null);
          ui.selectStashFile(null);
        } else if (ui.view === "settings") {
          e.preventDefault();
          ui.setView("graph");
        }
        return;
      }

      // Arrow navigation in the graph. Plain ArrowDown/ArrowUp walks the
      // visible commit list in order (next row / previous row), while
      // Shift+ArrowDown/ArrowUp jumps by parentage — useful for tracing
      // a specific branch through a merge without following a sibling.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        const active = useRepo.getState().tabs[useRepo.getState().activeIdx];
        if (!active) return;
        const ui = useUI.getState();
        if (ui.selectedCommit == null) return;
        const idx = active.commits.findIndex((c) => c.hash === ui.selectedCommit);
        if (idx < 0) return;
        const cur = active.commits[idx];
        if (e.shiftKey) {
          if (e.key === "ArrowDown") {
            const parentHash = cur.parents[0];
            if (parentHash) {
              e.preventDefault();
              ui.selectCommit(parentHash);
            }
          } else {
            const child = active.commits.find((c) => c.parents.includes(cur.hash));
            if (child) {
              e.preventDefault();
              ui.selectCommit(child.hash);
            }
          }
        } else {
          const step = e.key === "ArrowDown" ? 1 : -1;
          const next = active.commits[idx + step];
          if (next) {
            e.preventDefault();
            ui.selectCommit(next.hash);
          }
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd/Ctrl + T — open the Welcome overlay regardless of which
      // repo (if any) is active so the user can pick from Recents.
      if (e.key === "t" || e.key === "T") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        useUI.getState().setWelcomeOpen(true);
        return;
      }

      const active = useRepo.getState().tabs[useRepo.getState().activeIdx];
      if (!active) return;
      const status = active.status;

      // Cmd/Ctrl + W — close the active tab. Don't fire inside a text
      // input since users expect the OS "delete word" shortcut there.
      if (e.key === "w" || e.key === "W") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        void useRepo.getState().closeTab(active.path);
        return;
      }

      // Cmd/Ctrl + Enter — commit (only if a message box has text). Delegated
      // to the commit panel which owns the input state.
      if (e.key === "Enter") {
        const evt = new CustomEvent("gitvibed:commit");
        window.dispatchEvent(evt);
        e.preventDefault();
        return;
      }

      // Cmd/Ctrl + Z — reflog-based HEAD undo.
      // Cmd/Ctrl + Y — redo (Windows-style; a second binding rather than
      // Cmd+Shift+Z since the latter conflicts with text inputs' native
      // "redo" on macOS in common web controls).
      // Skip either when a text input has focus so normal per-field undo
      // still works while typing a commit message or filter. Also skip
      // while the merge editor is open — it owns its own chunk-level
      // undo history, and hijacking Cmd+Z would clobber that.
      if (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        if (useUI.getState().view === "merge") return;
        const isRedo = e.key === "y" || e.key === "Y";
        e.preventDefault();
        try {
          if (isRedo) {
            const res = await unwrap(window.gitApi.redoHead());
            toast("success", res?.label ? `Redid: ${res.label}` : "Redone");
          } else {
            const res = await unwrap(window.gitApi.undoHead());
            toast("success", res?.label ? `Undid: ${res.label}` : "Undone");
          }
          await useRepo.getState().refreshAll();
        } catch (err) {
          toast("error", err instanceof Error ? err.message : String(err));
        }
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
