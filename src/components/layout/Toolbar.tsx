import { useEffect, useRef, useState } from "react";
import { useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";
import {
  BranchIcon,
  ChevronDownIcon,
  FetchIcon,
  MoreIcon,
  PullIcon,
  PushIcon,
  RedoIcon,
  SearchIcon,
  SettingsIcon,
  StashIcon,
  TerminalIcon,
  UndoIcon,
  PlusIcon,
} from "../ui/Icons";
import { BranchCreateDialog } from "../branches/BranchCreateDialog";

type PullStrategy = "merge" | "rebase" | "ff-only";

// GitKraken-style toolbar: repo + branch selectors on the left, two button
// groups in the middle (history + sync / workflow), utilities on the right.
export function Toolbar() {
  const { status, branches, path } = useActiveTabShallow((t) => ({
    status: t?.status ?? null,
    branches: t?.branches ?? [],
    path: t?.path ?? null,
  }));
  const toast = useUI((s) => s.toast);
  const setCommandPalette = useUI((s) => s.setCommandPalette);
  const refreshAll = useRepo((s) => s.refreshAll);
  const defaultStrategy = useSettings((s) => s.defaultPullStrategy);
  const [busy, setBusy] = useState<"pull" | "push" | "fetch" | "stash" | "pop" | null>(null);
  const [pullMenuOpen, setPullMenuOpen] = useState(false);
  const [pushMenuOpen, setPushMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [showBranchCreate, setShowBranchCreate] = useState(false);

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

  async function runStash() {
    setBusy("stash");
    try {
      await unwrap(window.gitApi.stash());
      toast("success", "Stashed changes");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPop() {
    setBusy("pop");
    try {
      await unwrap(window.gitApi.stashPop());
      toast("success", "Popped stash");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openTerminal() {
    if (!path) return;
    try {
      await unwrap(window.gitApi.openExternal(`terminal://${path}`));
    } catch {
      // Best-effort: fall back to opening the folder if the terminal:// URL
      // isn't wired on this OS.
      toast("info", "Terminal integration coming soon");
    }
  }

  const changeCount =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.conflicted.length ?? 0);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2">
      <RepoSelector open={repoMenuOpen} setOpen={setRepoMenuOpen} />
      <div className="mx-1 h-6 w-px bg-neutral-800" />
      <BranchSelector
        open={branchMenuOpen}
        setOpen={setBranchMenuOpen}
        branches={branches}
        currentBranch={currentBranch}
      />

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarIconButton disabled title="Undo" hint="Cmd+Z">
        <UndoIcon className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton disabled title="Redo" hint="Cmd+Shift+Z">
        <RedoIcon className="size-4" />
      </ToolbarIconButton>

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarButton
        onClick={runFetch}
        disabled={!!busy}
        label="Fetch"
        hint="Cmd+Shift+F"
        icon={<FetchIcon className={`size-4 ${busy === "fetch" ? "animate-pulse" : ""}`} />}
      />
      <SplitButton
        label="Pull"
        badge={status?.behind || undefined}
        hint="Cmd+Shift+L"
        icon={<PullIcon className={`size-4 ${busy === "pull" ? "animate-pulse" : ""}`} />}
        disabled={!!busy || !currentBranch}
        onClick={() => runPull(defaultStrategy)}
        onToggleMenu={() => setPullMenuOpen((v) => !v)}
        menuOpen={pullMenuOpen}
        onMenuClose={() => setPullMenuOpen(false)}
      >
        <MenuItem onClick={() => runPull("merge")}>Merge (default)</MenuItem>
        <MenuItem onClick={() => runPull("rebase")}>Rebase</MenuItem>
        <MenuItem onClick={() => runPull("ff-only")}>Fast-forward only</MenuItem>
      </SplitButton>
      <SplitButton
        label="Push"
        badge={status?.ahead || undefined}
        hint="Cmd+Shift+P"
        icon={<PushIcon className={`size-4 ${busy === "push" ? "animate-pulse" : ""}`} />}
        disabled={!!busy || !currentBranch}
        onClick={() => runPush(false)}
        onToggleMenu={() => setPushMenuOpen((v) => !v)}
        menuOpen={pushMenuOpen}
        onMenuClose={() => setPushMenuOpen(false)}
      >
        <MenuItem onClick={() => runPush(false)}>Push</MenuItem>
        <MenuItem onClick={() => runPush(true)}>Force push (with lease)</MenuItem>
      </SplitButton>

      <div className="mx-2 h-6 w-px bg-neutral-800" />

      <ToolbarButton
        onClick={() => setShowBranchCreate(true)}
        disabled={!path}
        label="Branch"
        icon={<PlusIcon className="size-4" />}
      />
      <ToolbarButton
        onClick={runStash}
        disabled={!!busy || changeCount === 0}
        label="Stash"
        icon={<StashIcon className={`size-4 ${busy === "stash" ? "animate-pulse" : ""}`} />}
      />
      <ToolbarButton
        onClick={runPop}
        disabled={!!busy}
        label="Pop"
        icon={<StashIcon className={`size-4 ${busy === "pop" ? "animate-pulse" : ""}`} />}
      />

      <div className="ml-auto flex items-center gap-1">
        <ToolbarIconButton onClick={openTerminal} disabled={!path} title="Open in terminal">
          <TerminalIcon className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton
          onClick={() => useUI.getState().setView("settings")}
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </ToolbarIconButton>
        <ToolbarIconButton title="Actions">
          <MoreIcon className="size-4" />
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

// Repo selector — mirrors GitKraken's top-left "repository" pill. Clicking it
// opens a menu with recent repos + an "open" button. For now we just expose
// the current repo and let the TabBar do the rest.
function RepoSelector({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const path = useActiveTabShallow((t) => t?.path ?? null);
  const openRepo = useRepo((s) => s.openRepo);
  const toast = useUI((s) => s.toast);
  const [recents, setRecents] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const name = path ? path.split(/[\\/]/).pop() : "No repository";

  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      try {
        const res = await window.gitApi.recentRepos();
        if (res.ok) setRecents(res.data);
      } finally {
        setLoaded(true);
      }
    })();
  }, [open, loaded]);

  async function openByPath(p: string) {
    setOpen(false);
    try {
      await openRepo(p);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function browse() {
    setOpen(false);
    try {
      const res = await window.gitApi.showOpenDialog();
      if (res.ok) await openRepo(res.data);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="relative w-[200px] shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
        title={path ?? undefined}
      >
        <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
          <span className="text-[9px] uppercase tracking-wider text-neutral-500">repository</span>
          <span className="max-w-full truncate">{name}</span>
        </div>
        <ChevronDownIcon className="size-3 shrink-0 text-neutral-400" />
      </button>
      {open && (
        <DropdownMenu onClose={() => setOpen(false)} align="left">
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
        </DropdownMenu>
      )}
    </div>
  );
}

function BranchSelector({
  open,
  setOpen,
  branches,
  currentBranch,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  branches: import("@shared/types").Branch[];
  currentBranch: string | null;
}) {
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [filter, setFilter] = useState("");

  const filterLC = filter.trim().toLowerCase();
  const locals = branches
    .filter((b) => b.isLocal)
    .filter((b) => !filterLC || b.name.toLowerCase().includes(filterLC))
    .slice(0, 20);

  async function checkout(name: string) {
    setOpen(false);
    try {
      await unwrap(window.gitApi.checkout(name));
      toast("success", `Switched to ${name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="relative w-[200px] shrink-0">
      <button
        onClick={() => setOpen(!open)}
        disabled={!currentBranch}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
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
      </button>
      {open && (
        <DropdownMenu onClose={() => setOpen(false)} align="left" wide>
          <div className="px-2 pb-1">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
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
        </DropdownMenu>
      )}
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
}: {
  children?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  const title = hint ? `${label} (${hint})` : label;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex min-w-[56px] flex-col items-center rounded px-2 py-1 text-[10px] text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span>{label ?? children}</span>
    </button>
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
    <button
      onClick={onClick}
      disabled={disabled}
      title={full}
      className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SplitButton({
  label,
  badge,
  icon,
  hint,
  onClick,
  onToggleMenu,
  menuOpen,
  onMenuClose,
  disabled,
  children,
}: {
  label: string;
  badge?: number;
  icon: React.ReactNode;
  hint?: string;
  onClick: () => void;
  onToggleMenu: () => void;
  menuOpen: boolean;
  onMenuClose: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const title = hint ? `${label} (${hint})` : label;
  return (
    <div className="relative flex items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="flex min-w-[56px] flex-col items-center rounded-l px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
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
      <button
        onClick={onToggleMenu}
        disabled={disabled}
        className="rounded-r px-1 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronDownIcon className="size-3" />
      </button>
      {menuOpen && (
        <DropdownMenu onClose={onMenuClose} align="left" offsetTop>
          {children}
        </DropdownMenu>
      )}
    </div>
  );
}

function DropdownMenu({
  children,
  onClose,
  align = "left",
  wide,
  offsetTop,
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: "left" | "right";
  wide?: boolean;
  offsetTop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        ref={ref}
        className={`absolute z-20 ${offsetTop ? "top-full mt-1" : "top-full mt-1"} ${
          align === "left" ? "left-0" : "right-0"
        } ${wide ? "min-w-[260px]" : "min-w-[180px]"} rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg`}
      >
        {children}
      </div>
    </>
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
    <button
      onClick={onClick}
      className="flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-neutral-800" />;
}
