import { useEffect, useState } from "react";
import type { Branch } from "@shared/types";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { buildCreatePrUrl } from "../../lib/pr-url";
import { Prompt } from "../ui/Prompt";
import { useConfirm } from "../ui/Confirm";
import { useMenuPosition } from "../../hooks/useMenuPosition";

interface Props {
  x: number;
  y: number;
  branch: Branch;
  onClose: () => void;
  onMerge: (source: string) => void;
  onRebase: (source: string) => void;
  onRename: (branch: Branch) => void;
  onOpenPR: (branch: Branch) => void;
  onCreateBranch: (base: string) => void;
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
  onCreateBranch,
}: Props) {
  const { ref, pos } = useMenuPosition(x, y);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const ghAvailable = useActive("ghAvailable") ?? false;
  const remotes = useActive("remotes") ?? [];
  const prs = useActive("prs") ?? [];
  const confirmDialog = useConfirm();

  // A branch has a "live" PR if GitHub returned one whose head matches.
  // We use this to surface a "View PR in browser" action for existing
  // PRs, distinct from the "Open Pull Request…" action that starts a
  // new PR creation flow.
  const existingPR = branch.isLocal
    ? prs.find((p) => p.headRefName === branch.name)
    : null;
  const [busy, setBusy] = useState(false);
  const [upstreamPrompt, setUpstreamPrompt] = useState(false);

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
    if (
      force &&
      !(await confirmDialog({
        title: "Force push",
        message: `Force-push ${branch.name}?\nThis can overwrite remote history.`,
        confirmLabel: "Force push",
        danger: true,
      }))
    ) {
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

  // Always force-delete — previously we tried a safe delete first and only
  // offered force on failure, but that led to confirm-twice flows for
  // unmerged branches. The confirmation step below is the single gate;
  // `-D` is used unconditionally underneath.
  async function setUpstream(value: string) {
    setUpstreamPrompt(false);
    const target = value.trim();
    if (!target) {
      onClose();
      return;
    }
    try {
      await unwrap(window.gitApi.branchSetUpstream(branch.name, target));
      toast("success", `Tracking ${target}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function clearUpstream() {
    try {
      await unwrap(window.gitApi.branchSetUpstream(branch.name, null));
      toast("success", `Cleared tracking on ${branch.name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
    onClose();
  }

  async function resetCurrentTo(mode: "soft" | "mixed" | "hard") {
    onClose();
    const ok = await confirmDialog({
      title: `Reset to ${branch.name}`,
      message:
        mode === "hard"
          ? `Reset current branch to ${branch.name} (hard).\nThis discards all uncommitted changes.`
          : `Reset current branch to ${branch.name} (${mode}).`,
      confirmLabel: `Reset (${mode})`,
      danger: mode === "hard",
    });
    if (!ok) return;
    try {
      await unwrap(window.gitApi.reset(branch.name, mode));
      toast("success", `Reset to ${branch.name} (${mode})`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function copyName() {
    void navigator.clipboard.writeText(branch.name);
    toast("success", "Copied branch name");
    onClose();
  }

  async function del() {
    // Close the context menu first so it's not still floating behind the
    // confirm dialog and left open after the operation completes.
    onClose();
    const ok = await confirmDialog({
      title: `Delete ${branch.name}?`,
      message: `Force delete branch ${branch.name}?\nThis can discard unmerged commits.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await unwrap(window.gitApi.branchDelete(branch.name, true));
      toast("success", `Deleted ${branch.name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const canPull = branch.isLocal && !!branch.tracking;
  const canPush = branch.isLocal;

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[200px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
        style={pos}
      >
        {!branch.isHead && <Item onClick={checkout}>Checkout</Item>}
        <Item onClick={copyName}>Copy name</Item>
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
            onCreateBranch(branch.name);
            onClose();
          }}
        >
          Create branch from here…
        </Item>
        {(canPull || canPush) && <Divider />}
        {canPull && <Item onClick={pull}>Pull</Item>}
        {canPush && <Item onClick={() => push(false)}>Push</Item>}
        {canPush && <Item onClick={() => push(true)}>Force push (with lease)</Item>}
        {branch.isLocal && (
          <Item onClick={() => setUpstreamPrompt(true)}>Set upstream…</Item>
        )}
        {branch.isLocal && branch.tracking && (
          <Item onClick={clearUpstream}>Unset upstream</Item>
        )}
        <Divider />
        {existingPR ? (
          <Item
            onClick={() => {
              void window.gitApi.openExternal(existingPR.url);
              onClose();
            }}
          >
            View PR #{existingPR.number} in browser
          </Item>
        ) : (
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
        )}
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
        <Divider />
        <Item onClick={() => resetCurrentTo("soft")}>Reset current to this (soft)</Item>
        <Item onClick={() => resetCurrentTo("mixed")}>Reset current to this (mixed)</Item>
        <Item onClick={() => resetCurrentTo("hard")} danger>
          Reset current to this (hard)…
        </Item>
        {branch.isLocal && (
          <>
            <Divider />
            <Item onClick={() => del()} danger>
              Delete…
            </Item>
          </>
        )}
      </div>
      {upstreamPrompt && (
        <Prompt
          title={`Set upstream for ${branch.name}`}
          label="Tracking ref (e.g. origin/main, or empty to unset)"
          defaultValue={branch.tracking ?? ""}
          placeholder="origin/main"
          submitLabel="Set"
          onSubmit={setUpstream}
          onCancel={() => {
            setUpstreamPrompt(false);
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

function Divider() {
  return <div className="my-1 border-t border-neutral-800" />;
}
