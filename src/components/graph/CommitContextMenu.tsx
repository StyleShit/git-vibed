import { useEffect, useRef, useState } from "react";
import type { Commit } from "@shared/types";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { useConfirm } from "../ui/Confirm";
import { TagCreateDialog } from "../tags/TagCreateDialog";

export function CommitContextMenu({
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
  const ref = useRef<HTMLDivElement>(null);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const confirmDialog = useConfirm();
  const [showTag, setShowTag] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  async function cherryPick() {
    try {
      await unwrap(window.gitApi.cherryPick(commit.hash));
      toast("success", `Cherry-picked ${commit.hash.slice(0, 7)}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function revert() {
    const ok = await confirmDialog({
      title: `Revert ${commit.hash.slice(0, 7)}`,
      message: "This creates a new commit undoing the changes.",
      confirmLabel: "Revert",
    });
    if (!ok) return;
    try {
      await unwrap(window.gitApi.revert(commit.hash));
      toast("success", `Reverted ${commit.hash.slice(0, 7)}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function reset(mode: "soft" | "mixed" | "hard") {
    const ok = await confirmDialog({
      title: `Reset (${mode})`,
      message:
        mode === "hard"
          ? `Reset to ${commit.hash.slice(0, 7)} (hard).\nThis discards all uncommitted changes.`
          : `Reset to ${commit.hash.slice(0, 7)} (${mode}).`,
      confirmLabel: `Reset (${mode})`,
      danger: mode === "hard",
    });
    if (!ok) return;
    try {
      await unwrap(window.gitApi.reset(commit.hash, mode));
      toast("success", `Reset (${mode})`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function checkout() {
    try {
      await unwrap(window.gitApi.checkout(commit.hash));
      toast("info", `Detached HEAD at ${commit.hash.slice(0, 7)}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  function openTagDialog() {
    setShowTag(true);
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
        style={{ left: x, top: y }}
      >
        <Item onClick={checkout}>Checkout this commit</Item>
        <Item onClick={cherryPick}>Cherry-pick</Item>
        <Item onClick={revert}>Revert</Item>
        <div className="my-1 border-t border-neutral-800" />
        <Item onClick={openTagDialog}>Create tag here…</Item>
        <div className="my-1 border-t border-neutral-800" />
        <Item onClick={() => reset("soft")}>Reset (soft)</Item>
        <Item onClick={() => reset("mixed")}>Reset (mixed)</Item>
        <Item onClick={() => reset("hard")} danger>
          Reset (hard)
        </Item>
      </div>
      {showTag && (
        <TagCreateDialog
          initialRef={commit.hash}
          onClose={() => {
            setShowTag(false);
            onClose();
          }}
        />
      )}
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
