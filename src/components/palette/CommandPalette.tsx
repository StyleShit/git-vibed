import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveTabShallow, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { useSettings } from "../../stores/settings";
import {
  BranchIcon,
  CommitIcon,
  FetchIcon,
  PullIcon,
  PushIcon,
  SettingsIcon,
  StashIcon,
  TagIcon,
  WorktreeIcon,
  PullRequestIcon,
  SearchIcon,
} from "../ui/Icons";

// Fuzzy command palette (⌘P / Ctrl+P). Mirrors GitKraken's "Fuzzy Finder" —
// one search box over commands, branches, commits, tags, stashes, PRs. Ranks
// results by simple substring+subsequence scoring.
interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  group: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const open = useUI((s) => s.commandPaletteOpen);
  const setOpen = useUI((s) => s.setCommandPalette);
  const toast = useUI((s) => s.toast);
  const setView = useUI((s) => s.setView);
  const selectCommit = useUI((s) => s.selectCommit);
  const { branches, commits, stashes, tags, prs, worktrees, status } = useActiveTabShallow(
    (t) => ({
      branches: t?.branches ?? [],
      commits: t?.commits ?? [],
      stashes: t?.stashes ?? [],
      tags: t?.tags ?? [],
      prs: t?.prs ?? [],
      worktrees: t?.worktrees ?? [],
      status: t?.status ?? null,
    }),
  );
  const refreshAll = useRepo((s) => s.refreshAll);
  const openRepo = useRepo((s) => s.openRepo);
  const pullStrategy = useSettings((s) => s.defaultPullStrategy);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Defer focus to after the element mounts in the DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Global ⌘P / Ctrl+P toggle. Registered here so the palette itself owns
  // its shortcut; keeps the hook file uncluttered.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        setOpen(!useUI.getState().commandPaletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    // Quick commands — always at the top.
    out.push({
      id: "cmd:changes",
      label: "Show Changes",
      detail: "View uncommitted work",
      group: "Commands",
      icon: <CommitIcon className="size-3.5 text-neutral-400" />,
      run: () => setView("changes"),
    });
    out.push({
      id: "cmd:history",
      label: "Show History",
      detail: "Open the commit graph",
      group: "Commands",
      icon: <CommitIcon className="size-3.5 text-neutral-400" />,
      run: () => setView("graph"),
    });
    out.push({
      id: "cmd:fetch",
      label: "Fetch all",
      detail: "git fetch --all --prune",
      group: "Commands",
      icon: <FetchIcon className="size-3.5 text-neutral-400" />,
      run: async () => {
        try {
          await unwrap(window.gitApi.fetch({ all: true, prune: true }));
          toast("success", "Fetched");
          await refreshAll();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : String(e));
        }
      },
    });
    if (status?.branch) {
      out.push({
        id: "cmd:pull",
        label: "Pull",
        detail: `Pull ${status.branch} with ${pullStrategy}`,
        group: "Commands",
        icon: <PullIcon className="size-3.5 text-neutral-400" />,
        run: async () => {
          try {
            await unwrap(window.gitApi.pull({ strategy: pullStrategy }));
            toast("success", "Pulled");
            await refreshAll();
          } catch (e) {
            toast("error", e instanceof Error ? e.message : String(e));
          }
        },
      });
      out.push({
        id: "cmd:push",
        label: "Push",
        detail: `Push ${status.branch} to upstream`,
        group: "Commands",
        icon: <PushIcon className="size-3.5 text-neutral-400" />,
        run: async () => {
          try {
            await unwrap(
              window.gitApi.push({
                branch: status.branch!,
                remote: status.tracking?.split("/")[0],
                setUpstream: !status.tracking,
              }),
            );
            toast("success", "Pushed");
            await refreshAll();
          } catch (e) {
            toast("error", e instanceof Error ? e.message : String(e));
          }
        },
      });
    }
    out.push({
      id: "cmd:stash",
      label: "Stash changes",
      detail: "git stash push",
      group: "Commands",
      icon: <StashIcon className="size-3.5 text-neutral-400" />,
      run: async () => {
        try {
          await unwrap(window.gitApi.stash());
          toast("success", "Stashed");
          await refreshAll();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : String(e));
        }
      },
    });
    out.push({
      id: "cmd:stash-pop",
      label: "Pop stash",
      detail: "git stash pop",
      group: "Commands",
      icon: <StashIcon className="size-3.5 text-neutral-400" />,
      run: async () => {
        try {
          await unwrap(window.gitApi.stashPop());
          toast("success", "Popped");
          await refreshAll();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : String(e));
        }
      },
    });
    out.push({
      id: "cmd:settings",
      label: "Settings",
      detail: "Preferences",
      group: "Commands",
      icon: <SettingsIcon className="size-3.5 text-neutral-400" />,
      run: () => setView("settings"),
    });

    // Branches — checkout on pick.
    for (const b of branches) {
      if (!b.isLocal) continue;
      out.push({
        id: `branch:${b.name}`,
        label: b.name,
        detail: b.tracking ? `tracks ${b.tracking}` : "local branch",
        group: "Branches",
        icon: <BranchIcon className="size-3.5 text-neutral-400" />,
        run: async () => {
          try {
            await unwrap(window.gitApi.checkout(b.name));
            toast("success", `Switched to ${b.name}`);
            await refreshAll();
          } catch (e) {
            toast("error", e instanceof Error ? e.message : String(e));
          }
        },
      });
    }

    // Tags — jump to their commit. Guard against missing commit ids since
    // for-each-ref output can omit fields for malformed refs.
    for (const t of tags) {
      if (!t.name) continue;
      const sha = t.commit ? t.commit.slice(0, 7) : "";
      out.push({
        id: `tag:${t.name}`,
        label: t.name,
        detail: sha
          ? `${t.annotated ? "annotated" : "lightweight"} · ${sha}`
          : t.annotated
            ? "annotated"
            : "lightweight",
        group: "Tags",
        icon: <TagIcon className="size-3.5 text-amber-400" />,
        run: () => {
          setView("graph");
          if (t.commit) selectCommit(t.commit);
        },
      });
    }

    // Stashes — apply on pick.
    for (const s of stashes) {
      out.push({
        id: `stash:${s.ref}`,
        label: s.message.replace(/^(?:WIP )?[Oo]n [^:]+:\s*/, ""),
        detail: `${s.ref} · ${s.branch ?? "?"}`,
        group: "Stashes",
        icon: <StashIcon className="size-3.5 text-neutral-400" />,
        run: async () => {
          try {
            await unwrap(window.gitApi.stashApply(s.index));
            toast("success", "Applied stash");
            await refreshAll();
          } catch (e) {
            toast("error", e instanceof Error ? e.message : String(e));
          }
        },
      });
    }

    // Worktrees — open in new tab.
    for (const w of worktrees) {
      const name = w.path.split(/[\\/]/).pop() ?? w.path;
      out.push({
        id: `worktree:${w.path}`,
        label: name,
        detail: w.branch ? `worktree · ${w.branch}` : "worktree",
        group: "Worktrees",
        icon: <WorktreeIcon className="size-3.5 text-neutral-400" />,
        run: async () => {
          try {
            await openRepo(w.path);
          } catch (e) {
            toast("error", e instanceof Error ? e.message : String(e));
          }
        },
      });
    }

    // Pull requests — open in the PR detail view.
    for (const p of prs) {
      out.push({
        id: `pr:${p.number}`,
        label: `#${p.number} ${p.title}`,
        detail: `${p.state.toLowerCase()} · ${p.headRefName} → ${p.baseRefName}`,
        group: "Pull Requests",
        icon: <PullRequestIcon className="size-3.5 text-neutral-400" />,
        run: () => {
          useUI.getState().selectPR(p.number);
        },
      });
    }

    // Commits — limit to recent page to keep scoring fast.
    for (const c of commits.slice(0, 500)) {
      out.push({
        id: `commit:${c.hash}`,
        label: c.subject,
        detail: `${c.hash.slice(0, 7)} · ${c.author}`,
        group: "Commits",
        icon: <CommitIcon className="size-3.5 text-neutral-400" />,
        run: () => {
          setView("graph");
          selectCommit(c.hash);
        },
      });
    }

    return out;
  }, [
    branches,
    commits,
    stashes,
    tags,
    prs,
    worktrees,
    status,
    pullStrategy,
    setView,
    selectCommit,
    refreshAll,
    openRepo,
    toast,
  ]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 50);
    const q = query.toLowerCase();
    return items
      .map((it) => ({ it, score: score(q, it) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.it);
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function run(item: PaletteItem) {
    setOpen(false);
    void item.run();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[560px] max-w-[92vw] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          <SearchIcon className="size-4 text-neutral-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[index];
                if (item) run(item);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Type a command, branch, tag, commit…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
          />
          <span className="text-[10px] text-neutral-500">esc</span>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-neutral-500">No matches</li>
          )}
          {filtered.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(it)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                  i === index ? "bg-neutral-800" : "hover:bg-neutral-800/50"
                }`}
              >
                {it.icon}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-100">{it.label}</div>
                  {it.detail && (
                    <div className="truncate text-[11px] text-neutral-500">{it.detail}</div>
                  )}
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-600">
                  {it.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Simple relevance score — exact substring beats subsequence match, and
// earlier matches score higher. Good enough for a few thousand items.
function score(q: string, it: PaletteItem): number {
  const label = it.label.toLowerCase();
  const detail = (it.detail ?? "").toLowerCase();
  const full = `${label} ${detail}`;
  if (label.startsWith(q)) return 100 - label.indexOf(q);
  if (label.includes(q)) return 60 - label.indexOf(q);
  if (full.includes(q)) return 30;
  // subsequence fallback
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}
