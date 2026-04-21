import { useEffect, useRef } from "react";
import type { Branch } from "@shared/types";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

interface Props {
  x: number;
  y: number;
  branch: Branch;
  onClose: () => void;
  onMerge: (source: string) => void;
  onRebase: (source: string) => void;
  onRename: (branch: Branch) => void;
}

export function BranchContextMenu({ x, y, branch, onClose, onMerge, onRebase, onRename }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  async function checkout() {
    try {
      await unwrap(window.gitApi.checkout(branch.name));
      toast("success", `Switched to ${branch.name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function del(force = false) {
    if (!confirm(`Delete branch ${branch.name}${force ? " (force)" : ""}?`)) {
      onClose();
      return;
    }
    try {
      await unwrap(window.gitApi.branchDelete(branch.name, force));
      toast("success", `Deleted ${branch.name}`);
      await refreshAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!force && /not fully merged/i.test(msg)) {
        if (confirm("Branch is not fully merged. Force delete?")) {
          return del(true);
        }
      }
      toast("error", msg);
    }
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
        style={{ left: x, top: y }}
      >
        {!branch.isHead && <Item onClick={checkout}>Checkout</Item>}
        {branch.isLocal && (
          <Item
            onClick={() => {
              onRename(branch);
              onClose();
            }}
          >
            Rename…
          </Item>
        )}
        <Item
          onClick={() => {
            onMerge(branch.name);
            onClose();
          }}
        >
          Merge into current…
        </Item>
        <Item
          onClick={() => {
            onRebase(branch.name);
            onClose();
          }}
        >
          Rebase current onto…
        </Item>
        {branch.isLocal && (
          <>
            <div className="my-1 border-t border-neutral-800" />
            <Item onClick={() => del(false)} danger>
              Delete…
            </Item>
          </>
        )}
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
