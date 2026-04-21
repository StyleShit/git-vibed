import { useRef, useState } from "react";
import { useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";

type PullStrategy = "merge" | "rebase" | "ff-only";

// The "Open PR" button used to live here; it's now exposed per-branch from
// the branch right-click menu where we know the head ref to use.
export function Toolbar() {
  const { status } = useActiveTabShallow((t) => ({
    status: t?.status ?? null,
  }));
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const defaultStrategy = useSettings((s) => s.defaultPullStrategy);
  const [busy, setBusy] = useState<"pull" | "push" | "fetch" | null>(null);
  const [pullMenuOpen, setPullMenuOpen] = useState(false);
  const [pushMenuOpen, setPushMenuOpen] = useState(false);

  const currentBranch = status?.branch ?? null;

  async function runPull(strategy: PullStrategy) {
    setPullMenuOpen(false);
    if (!currentBranch) return;
    setBusy("pull");
    try {
      await unwrap(window.gitApi.pull({ strategy }));
      toast("success", "Pulled");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPush(force = false) {
    setPushMenuOpen(false);
    if (!currentBranch) return;
    if (force && !confirm("Force push? This can overwrite remote history.")) return;
    setBusy("push");
    try {
      await unwrap(
        window.gitApi.push({
          branch: currentBranch,
          remote: status?.tracking?.split("/")[0],
          setUpstream: !status?.tracking,
          force,
        }),
      );
      toast("success", force ? "Force-pushed" : "Pushed");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runFetch() {
    setBusy("fetch");
    try {
      await unwrap(window.gitApi.fetch({ all: true, prune: true }));
      toast("success", "Fetched");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2">
      <ToolbarButton onClick={runFetch} disabled={!!busy}>
        {busy === "fetch" ? "…" : "Fetch"}
      </ToolbarButton>
      <div className="relative">
        <SplitButton
          label={busy === "pull" ? "…" : `Pull${status?.behind ? ` (${status.behind})` : ""}`}
          disabled={!!busy || !currentBranch}
          onClick={() => runPull(defaultStrategy)}
          onToggleMenu={() => setPullMenuOpen((v) => !v)}
        />
        {pullMenuOpen && (
          <DropdownMenu onClose={() => setPullMenuOpen(false)}>
            <MenuItem onClick={() => runPull("merge")}>Merge (default)</MenuItem>
            <MenuItem onClick={() => runPull("rebase")}>Rebase</MenuItem>
            <MenuItem onClick={() => runPull("ff-only")}>Fast-forward only</MenuItem>
          </DropdownMenu>
        )}
      </div>
      <div className="relative">
        <SplitButton
          label={busy === "push" ? "…" : `Push${status?.ahead ? ` (${status.ahead})` : ""}`}
          disabled={!!busy || !currentBranch}
          onClick={() => runPush(false)}
          onToggleMenu={() => setPushMenuOpen((v) => !v)}
        />
        {pushMenuOpen && (
          <DropdownMenu onClose={() => setPushMenuOpen(false)}>
            <MenuItem onClick={() => runPush(false)}>Push</MenuItem>
            <MenuItem onClick={() => runPush(true)}>Force push (with lease)</MenuItem>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SplitButton({
  label,
  onClick,
  onToggleMenu,
  disabled,
}: {
  label: string;
  onClick: () => void;
  onToggleMenu: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md hover:bg-neutral-800">
      <button
        onClick={onClick}
        disabled={disabled}
        className="rounded-l-md px-3 py-1.5 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
      <button
        onClick={onToggleMenu}
        disabled={disabled}
        className="rounded-r-md px-1.5 py-1.5 text-neutral-400 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        ▾
      </button>
    </div>
  );
}

function DropdownMenu({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        ref={ref}
        className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
      >
        {children}
      </div>
    </>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}
