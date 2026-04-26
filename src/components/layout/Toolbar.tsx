import { useState } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRepo, useActivePath } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";
import {
  gitBranchesOptions,
  gitStatusOptions,
  gitUndoOptions,
} from "../../queries/gitApi";
import {
  checkoutMutation,
  fetchMutation,
  pullMutation,
  pushMutation,
  redoHeadMutation,
  stashCreateMutation,
  stashPopMutation,
  undoHeadMutation,
} from "../../queries/mutations";
import {
  BranchIcon,
  ChevronDownIcon,
  FetchIcon,
  PullIcon,
  PushIcon,
  RedoIcon,
  SearchIcon,
  SettingsIcon,
  StashIcon,
  UndoIcon,
  PlusIcon,
} from "../ui/Icons";
import { BranchCreateDialog } from "../branches/BranchCreateDialog";
import { useConfirm } from "../ui/Confirm";
import { Tooltip } from "../ui/Tooltip";

type PullStrategy = "merge" | "rebase" | "ff-only";

// Toolbar layout: repo + branch selectors on the left, two button groups
// in the middle (history + sync / workflow), utilities on the right.
export function Toolbar() {
  const path = useActivePath();
  const backgroundFetching = useRepo(
    (s) => s.tabs[s.activeIdx]?.backgroundFetching ?? false,
  );
  const status = useQuery(gitStatusOptions(path)).data ?? null;
  const branches = useQuery(gitBranchesOptions(path)).data ?? [];
  const undo =
    useQuery(gitUndoOptions(path)).data ?? { canUndo: false, canRedo: false };
  const stashCreateMut = useMutation(stashCreateMutation(path ?? ""));
  const stashPopMut = useMutation(stashPopMutation(path ?? ""));
  const undoHeadMut = useMutation(undoHeadMutation(path ?? ""));
  const redoHeadMut = useMutation(redoHeadMutation(path ?? ""));
  const pullMut = useMutation(pullMutation(path ?? ""));
  const pushMut = useMutation(pushMutation(path ?? ""));
  const fetchMut = useMutation(fetchMutation(path ?? ""));
  const toast = useUI((s) => s.toast);
  const setCommandPalette = useUI((s) => s.setCommandPalette);
  const view = useUI((s) => s.view);
  const confirmDialog = useConfirm();
  const defaultStrategy = useSettings((s) => s.defaultPullStrategy);
  // Most history/sync actions are nonsense while resolving a merge:
  // pull/push/fetch, stash, undo/redo, and switching branches all
  // either error out or silently do the wrong thing. Disable them so
  // the user focuses on finishing the merge.
  const mergeActive = view === "merge";
  const [busy, setBusy] = useState<
    "pull" | "push" | "fetch" | "stash" | "pop" | "undo" | "redo" | null
  >(null);
  const [showBranchCreate, setShowBranchCreate] = useState(false);

  const currentBranch = status?.branch ?? null;

  async function runPull(strategy: PullStrategy) {
    if (!currentBranch) return;
    setBusy("pull");
    try {
      await pullMut.mutateAsync({ strategy });
      toast("success", "Pulled");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPush(force = false) {
    if (!currentBranch) return;
    if (
      force &&
      !(await confirmDialog({
        title: "Force push",
        message: "Force push? This can overwrite remote history.",
        confirmLabel: "Force push",
        danger: true,
      }))
    ) {
      return;
    }
    setBusy("push");
    try {
      await pushMut.mutateAsync({
        branch: currentBranch,
        remote: status?.tracking?.split("/")[0],
        setUpstream: !status?.tracking,
        force,
      });
      toast("success", force ? "Force-pushed" : "Pushed");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runFetch() {
    setBusy("fetch");
    try {
      await fetchMut.mutateAsync({ all: true, prune: true });
      toast("success", "Fetched");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runStash() {
    setBusy("stash");
    try {
      await stashCreateMut.mutateAsync(undefined);
      toast("success", "Stashed changes");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPop() {
    setBusy("pop");
    try {
      await stashPopMut.mutateAsync();
      toast("success", "Popped stash");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runUndo() {
    if (busy || !undo.canUndo) return;
    setBusy("undo");
    try {
      const res = await undoHeadMut.mutateAsync();
      toast("success", res?.label ? `Undid: ${res.label}` : "Undone");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runRedo() {
    if (busy || !undo.canRedo) return;
    setBusy("redo");
    try {
      const res = await redoHeadMut.mutateAsync();
      toast("success", res?.label ? `Redid: ${res.label}` : "Redone");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const changeCount =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.conflicted.length ?? 0);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2">
      <RepoSelector />
      <div className="mx-1 h-6 w-px bg-neutral-800" />
      <BranchSelector
        branches={branches}
        currentBranch={currentBranch}
        disabled={mergeActive}
      />

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarIconButton
        onClick={runUndo}
        disabled={!path || !undo.canUndo || !!busy || mergeActive}
        title={undo.undoLabel ? `Undo: ${undo.undoLabel}` : "Undo"}
        hint="Cmd+Z"
      >
        <UndoIcon className={`size-4 ${busy === "undo" ? "animate-pulse" : ""}`} />
      </ToolbarIconButton>
      <ToolbarIconButton
        onClick={runRedo}
        disabled={!path || !undo.canRedo || !!busy || mergeActive}
        title={undo.redoLabel ? `Redo: ${undo.redoLabel}` : "Redo"}
        hint="Cmd+Y"
      >
        <RedoIcon className={`size-4 ${busy === "redo" ? "animate-pulse" : ""}`} />
      </ToolbarIconButton>

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarButton
        onClick={runFetch}
        disabled={!!busy || mergeActive}
        label="Fetch"
        hint="Cmd+Shift+F"
        title={backgroundFetching ? "Background fetch in progress…" : undefined}
        icon={
          <span className="relative inline-flex">
            <FetchIcon
              className={`size-4 ${
                busy === "fetch" || backgroundFetching ? "animate-spin text-indigo-400" : ""
              }`}
            />
            {backgroundFetching && busy !== "fetch" && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-indigo-400 shadow-[0_0_4px_rgba(129,140,248,0.9)]"
              />
            )}
          </span>
        }
      />
      <SplitButton
        label="Pull"
        badge={status?.behind || undefined}
        hint="Cmd+Shift+L"
        icon={<PullIcon className={`size-4 ${busy === "pull" ? "animate-pulse" : ""}`} />}
        disabled={!!busy || !currentBranch || mergeActive}
        onClick={() => runPull(defaultStrategy)}
      >
        <MenuItem onClick={() => runPull("merge")}>
          Merge{defaultStrategy === "merge" ? " (default)" : ""}
        </MenuItem>
        <MenuItem onClick={() => runPull("rebase")}>
          Rebase{defaultStrategy === "rebase" ? " (default)" : ""}
        </MenuItem>
        <MenuItem onClick={() => runPull("ff-only")}>
          Fast-forward only{defaultStrategy === "ff-only" ? " (default)" : ""}
        </MenuItem>
      </SplitButton>
      <SplitButton
        label="Push"
        badge={status?.ahead || undefined}
        hint="Cmd+Shift+P"
        icon={<PushIcon className={`size-4 ${busy === "push" ? "animate-pulse" : ""}`} />}
        disabled={!!busy || !currentBranch || mergeActive}
        onClick={() => runPush(false)}
      >
        <MenuItem onClick={() => runPush(false)}>Push</MenuItem>
        <MenuItem onClick={() => runPush(true)}>Force push (with lease)</MenuItem>
      </SplitButton>

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarButton
        onClick={() => setShowBranchCreate(true)}
        disabled={!path || mergeActive}
        label="Branch"
        icon={<PlusIcon className="size-4" />}
      />
      <ToolbarButton
        onClick={runStash}
        disabled={!!busy || changeCount === 0 || mergeActive}
        label="Stash"
        icon={<StashIcon className={`size-4 ${busy === "stash" ? "animate-pulse" : ""}`} />}
      />
      <ToolbarButton
        onClick={runPop}
        disabled={!!busy || mergeActive}
        label="Pop"
        icon={<StashIcon className={`size-4 ${busy === "pop" ? "animate-pulse" : ""}`} />}
      />

      <div className="ml-auto flex items-center gap-1">
        <ToolbarIconButton
          onClick={() => useUI.getState().setView("settings")}
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton
          onClick={() => setCommandPalette(true)}
          title="Command palette"
          hint="Cmd+P"
        >
          <SearchIcon className="size-4" />
        </ToolbarIconButton>
      </div>

      {showBranchCreate && <BranchCreateDialog onClose={() => setShowBranchCreate(false)} />}
    </div>
  );
}

// Repo selector — the top-left "repository" pill. Clicking it opens a menu
// with recent repos + an "open" button.
function RepoSelector() {
  const path = useActivePath();
  const openRepo = useRepo((s) => s.openRepo);
  const toast = useUI((s) => s.toast);
  const [recents, setRecents] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const name = path ? path.split(/[\\/]/).pop() : "No repository";

  async function loadRecents() {
    if (loaded) return;
    try {
      const res = await window.gitApi.recentRepos();
      if (res.ok) setRecents(res.data);
    } finally {
      setLoaded(true);
    }
  }

  async function openByPath(p: string) {
    try {
      await openRepo(p);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function browse() {
    try {
      const res = await window.gitApi.showOpenDialog();
      if (res.ok) await openRepo(res.data);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="w-[200px] shrink-0">
      <Menu.Root
        modal={false}
        onOpenChange={(open) => {
          if (open) void loadRecents();
        }}
      >
        <Menu.Trigger
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
          title={path ?? undefined}
        >
          <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-neutral-500">
              repository
            </span>
            <span className="max-w-full truncate">{name}</span>
          </div>
          <ChevronDownIcon className="size-3 shrink-0 text-neutral-400" />
        </Menu.Trigger>
        <MenuDropdown>
          <MenuItem onClick={browse}>Open repository…</MenuItem>
          {recents.length > 0 && (
            <>
              <MenuSeparator />
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
                Recent
              </div>
              {recents.slice(0, 8).map((r) => (
                <MenuItem key={r} onClick={() => openByPath(r)}>
                  <span className="truncate">{r.split(/[\\/]/).pop()}</span>
                  <span className="ml-2 truncate text-[10px] text-neutral-500">{r}</span>
                </MenuItem>
              ))}
            </>
          )}
        </MenuDropdown>
      </Menu.Root>
    </div>
  );
}

function BranchSelector({
  branches,
  currentBranch,
  disabled,
}: {
  branches: import("@shared/types").Branch[];
  currentBranch: string | null;
  disabled?: boolean;
}) {
  const activePath = useActivePath();
  const checkoutMut = useMutation(checkoutMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const [filter, setFilter] = useState("");

  const filterLC = filter.trim().toLowerCase();
  const locals = branches
    .filter((b) => b.isLocal)
    .filter((b) => !filterLC || b.name.toLowerCase().includes(filterLC))
    .slice(0, 20);

  async function checkout(name: string) {
    try {
      await checkoutMut.mutateAsync(name);
      toast("success", `Switched to ${name}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="w-[200px] shrink-0">
      <Menu.Root
        modal={false}
        onOpenChange={(open) => {
          if (!open) setFilter("");
        }}
      >
        <Menu.Trigger
          disabled={!currentBranch || disabled}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          title={currentBranch ?? "detached"}
        >
          <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-neutral-500">branch</span>
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <BranchIcon className="size-3 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate">{currentBranch ?? "detached"}</span>
            </span>
          </div>
          <ChevronDownIcon className="size-3 shrink-0 text-neutral-400" />
        </Menu.Trigger>
        <MenuDropdown wide>
          <div className="px-2 pb-1">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                // Prevent Menu's arrow/letter-based roving focus from
                // swallowing input keystrokes.
                if (e.key !== "Escape" && e.key !== "Enter") {
                  e.stopPropagation();
                }
              }}
              placeholder="Filter branches…"
              className="w-full rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <MenuSeparator />
          {locals.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">No matches</div>
          )}
          {locals.map((b) => (
            <MenuItem key={b.name} onClick={() => checkout(b.name)}>
              {b.isHead && (
                <span className="mr-1 inline-block size-1.5 rounded-full bg-indigo-400" />
              )}
              <span className="flex-1 truncate">{b.name}</span>
              {b.ahead ? (
                <span className="ml-2 text-[10px] text-emerald-400">↑{b.ahead}</span>
              ) : null}
              {b.behind ? (
                <span className="ml-1 text-[10px] text-amber-400">↓{b.behind}</span>
              ) : null}
            </MenuItem>
          ))}
        </MenuDropdown>
      </Menu.Root>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  label,
  hint,
  icon,
  title: titleOverride,
}: {
  children?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
  title?: string;
}) {
  const title = titleOverride ?? (hint ? `${label} (${hint})` : label);
  return (
    <Tooltip content={title}>
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex min-w-[56px] flex-col items-center rounded px-2 py-1 text-[10px] text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {icon}
        <span>{label ?? children}</span>
      </button>
    </Tooltip>
  );
}

function ToolbarIconButton({
  children,
  onClick,
  disabled,
  title,
  hint,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  hint?: string;
}) {
  const full = hint ? `${title} (${hint})` : title;
  return (
    <Tooltip content={full}>
      <button
        onClick={onClick}
        disabled={disabled}
        className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function SplitButton({
  label,
  badge,
  icon,
  hint,
  onClick,
  disabled,
  children,
}: {
  label: string;
  badge?: number;
  icon: React.ReactNode;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const title = hint ? `${label} (${hint})` : label;
  // Wrap the two halves in a shared `group` so hovering either side lights
  // the whole pill up at once. Previously each half had its own
  // `hover:bg-*` and the gap between them (and their rounded-l/rounded-r
  // edges) produced a visible seam that looked like a rendering bug.
  return (
    <div className="group/split flex items-stretch rounded hover:bg-neutral-800">
      <Tooltip content={title}>
        <button
          onClick={onClick}
          disabled={disabled}
          className="flex min-w-[56px] flex-col items-center rounded-l px-2 py-1 text-[10px] text-neutral-300 group-hover/split:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="relative">
            {icon}
            {badge != null && badge > 0 && (
              <span className="absolute -right-1.5 -top-1 min-w-3.5 rounded-full bg-indigo-500 px-1 text-[9px] leading-[14px] text-white">
                {badge}
              </span>
            )}
          </div>
          <span>{label}</span>
        </button>
      </Tooltip>
      <Menu.Root modal={false}>
        <Menu.Trigger
          disabled={disabled}
          className="flex items-center rounded-r px-1 py-1 text-neutral-400 group-hover/split:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDownIcon className="size-3" />
        </Menu.Trigger>
        <MenuDropdown>{children}</MenuDropdown>
      </Menu.Root>
    </div>
  );
}

function MenuDropdown({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side="bottom"
        align="start"
        sideOffset={4}
        className="z-50 outline-none"
      >
        <Menu.Popup
          className={`${
            wide ? "min-w-[260px]" : "min-w-[180px]"
          } rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg outline-none`}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex w-full cursor-default items-center whitespace-nowrap px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-neutral-800"
    >
      {children}
    </Menu.Item>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-neutral-800" />;
}
