import { useEffect, useRef, useState } from "react";
import type { Branch } from "@shared/types";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { buildCreatePrUrl } from "../../lib/pr-url";

interface Props {
  x: number;
  y: number;
  branch: Branch;
  onClose: () => void;
  onMerge: (source: string) => void;
  onRebase: (source: string) => void;
  onRename: (branch: Branch) => void;
  onOpenPR: (branch: Branch) => void;
}

export function BranchContextMenu({
  x,
  y,
  branch,
  onClose,
  onMerge,
  onRebase,
  onRename,
  onOpenPR,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const ghAvailable = useActive("ghAvailable") ?? false;
  const remotes = useActive("remotes") ?? [];
  const [busy, setBusy] = useState(false);

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

  async function run<T>(label: string, fn: () => Promise<T>, successMsg?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) toast("success", successMsg);
      await refreshAll();
    } catch (e) {
      toast("error", `${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      onClose();
    }
  }

  async function checkout() {
    await run("Checkout", () => unwrap(window.gitApi.checkout(branch.name)), `Switched to ${branch.name}`);
  }

  async function pull() {
    await run("Pull", () => unwrap(window.gitApi.pullBranch(branch.name)), `Pulled ${branch.name}`);
  }

  async function push(force = false) {
    if (force && !confirm(`Force-push ${branch.name}? This can overwrite remote history.`)) {
      onClose();
      return;
    }
    await run(
      force ? "Force push" : "Push",
      () => unwrap(window.gitApi.pushBranch(branch.name, force)),
      force ? `Force-pushed ${branch.name}` : `Pushed ${branch.name}`,
    );
  }

  // For branches we can't create a PR for in-app (no gh), fall back to the
  // host's web compare/PR URL so the user isn't dead-ended.
  async function openPRInBrowser() {
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    if (!origin) {
      toast("error", "No remote configured");
      onClose();
      return;
    }
    // Default the base to the repo's main-ish branch — we don't have gh repo
    // info here so fall back to common names.
    const base = "main";
    const url = buildCreatePrUrl(origin.fetchUrl, base, branch.name);
    if (!url) {
      toast("error", "Unsupported git host for PR fallback");
      onClose();
      return;
    }
    await window.gitApi.openExternal(url);
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

  const canPull = branch.isLocal && !!branch.tracking;
  const canPush = branch.isLocal;

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[200px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
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
        {(canPull || canPush) && <Divider />}
        {canPull && <Item onClick={pull}>Pull</Item>}
        {canPush && <Item onClick={() => push(false)}>Push</Item>}
        {canPush && <Item onClick={() => push(true)}>Force push (with lease)</Item>}
        <Divider />
        <Item
          onClick={() => {
            if (ghAvailable) {
              onOpenPR(branch);
              onClose();
            } else {
              void openPRInBrowser();
            }
          }}
        >
          Open Pull Request…
        </Item>
        <Divider />
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
            <Divider />
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

function Divider() {
  return <div className="my-1 border-t border-neutral-800" />;
}
