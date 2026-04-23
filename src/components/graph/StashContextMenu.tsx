import { useEffect } from "react";
import type { Commit } from "@shared/types";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { useConfirm } from "../ui/Confirm";
import { useMenuPosition } from "../../hooks/useMenuPosition";

// Context menu shown when the user right-clicks a commit that also
// happens to be a stash entry (carries a `stash`/`refs/stash`
// decoration in git log). Stashes aren't really regular commits, so
// revert/cherry-pick/reset don't make sense here — we offer the
// stash-specific verbs instead and fall back to the user's saved
// stash list when we can't resolve the index.
export function StashContextMenu({
  x,
  y,
  commit,
  onClose,
}: {
  x: number;
  y: number;
  commit: Commit;
  onClose: () => void;
}) {
  const { ref, pos } = useMenuPosition(x, y);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const stashes = useActive("stashes") ?? [];
  const confirmDialog = useConfirm();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  // Map the clicked commit back to its stash entry by hash. `refs/stash`
  // only decorates stash@{0}, so the graph decoration alone isn't
  // enough when the user has several stashes stacked — matching on the
  // commit SHA resolves the right index regardless of depth.
  const stashEntry =
    stashes.find((s) => s.hash === commit.hash) ??
    stashes.find((s) => s.index === 0) ??
    null;

  async function run(label: string, fn: () => Promise<unknown>, closeMenu = true) {
    try {
      await fn();
      toast("success", label);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    if (closeMenu) onClose();
  }

  async function apply() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      onClose();
      return;
    }
    await run("Applied stash", () =>
      unwrap(window.gitApi.stashApply(stashEntry.index)),
    );
  }

  async function pop() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      onClose();
      return;
    }
    if (stashEntry.index === 0) {
      await run("Popped stash", () => unwrap(window.gitApi.stashPop()));
    } else {
      await run("Popped stash", async () => {
        await unwrap(window.gitApi.stashApply(stashEntry.index));
        await unwrap(window.gitApi.stashDrop(stashEntry.index));
      });
    }
  }

  async function drop() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      onClose();
      return;
    }
    onClose();
    const ok = await confirmDialog({
      title: "Drop stash",
      message: `Drop ${stashEntry.ref}?\nThis can't be undone.`,
      confirmLabel: "Drop",
      danger: true,
    });
    if (!ok) return;
    await run(
      "Dropped stash",
      () => unwrap(window.gitApi.stashDrop(stashEntry.index)),
      false,
    );
  }

  function copyHash() {
    void navigator.clipboard.writeText(commit.hash);
    toast("success", "Copied hash");
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[200px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
        style={pos}
      >
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
          stash · {commit.hash.slice(0, 7)}
        </div>
        <Item onClick={apply}>Apply</Item>
        <Item onClick={pop}>Pop</Item>
        <Item onClick={drop} danger>
          Drop…
        </Item>
        <div className="my-1 border-t border-neutral-800" />
        <Item onClick={copyHash}>Copy hash</Item>
      </div>
    </>
  );
}

function Item({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-800 ${
        danger ? "text-red-400" : "text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}
