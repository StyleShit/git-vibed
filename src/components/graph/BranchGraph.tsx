import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useActiveTab } from "../../stores/repo";
import {
  gitBranchesOptions,
  gitLogOptions,
  gitRemotesOptions,
  gitStatusOptions,
} from "../../queries/gitApi";
import { useWipCount } from "../../queries/wipCount";
import {
  branchRenameMutation,
  checkoutCreateMutation,
  checkoutMutation,
  mergeMutation,
  resetMutation,
} from "../../queries/mutations";
import { useUI } from "../../stores/ui";
import type { GraphColumns } from "../../stores/settings";
import { layoutCommits, type GraphLayout } from "../../lib/graph-layout";
import { CommitDetail } from "./CommitDetail";
import { CommitContextMenu } from "./CommitContextMenu";
import { StashContextMenu } from "./StashContextMenu";
import { BranchContextMenu } from "../branches/BranchContextMenu";
import { BranchCreateDialog } from "../branches/BranchCreateDialog";
import { MergeRebaseDialog } from "../branches/MergeRebaseDialog";
import { Prompt } from "../ui/Prompt";
import { PRCreateDialog } from "../github/PRCreateDialog";
import { ChangesPanel } from "./ChangesPanel";
import { StashDetail } from "../stashes/StashDetail";
import { CommitFileDiff } from "./CommitFileDiff";
import { WipFileDiff } from "./WipFileDiff";
import { StashFileDiff } from "./StashFileDiff";
import { ResizeHandle } from "../ui/ResizeHandle";
import { useSettings } from "../../stores/settings";
import {
  CheckIcon,
  ComputerIcon,
  RemoteIcon,
  StashIcon,
  TagIcon,
  SettingsIcon,
  PlusIcon,
} from "../ui/Icons";
import { Avatar, RemoteAvatar } from "../ui/Avatar";
import { unwrap } from "../../lib/ipc";
import { useConfirm } from "../ui/Confirm";
import type { Commit } from "@shared/types";

// Graph columns: refs | graph | message | author | date | sha.
// Columns after "message" are toggleable via the gear menu in the header.
// 30px gives the commit subject enough vertical breathing room to stay
// scannable even in dense histories; at 26px rows felt cramped.
const ROW_HEIGHT = 30;
const LANE_WIDTH = 14;
const CIRCLE_R = 4;
const GRAPH_INNER_PADDING = 12;
const REFS_COL_WIDTH = 220;
const AUTHOR_COL_WIDTH = 140;
const DATE_COL_WIDTH = 110;
const SHA_COL_WIDTH = 70;

export function BranchGraph() {
  const activePath = useActiveTab()?.path;
  const logQuery = useInfiniteQuery(gitLogOptions(activePath));
  const commits = useMemo(
    () => logQuery.data?.pages.flat() ?? [],
    [logQuery.data],
  );
  const status = useQuery(gitStatusOptions(activePath)).data;
  const selected = useUI((s) => s.selectedCommit);
  const selectedStash = useUI((s) => s.selectedStash);
  const selectCommit = useUI((s) => s.selectCommit);
  const selectCommitFile = useUI((s) => s.selectCommitFile);
  const selectWipFile = useUI((s) => s.selectWipFile);
  const selectedCommitFile = useUI((s) => s.selectedCommitFile);
  const selectedWipFile = useUI((s) => s.selectedWipFile);
  const selectedStashFile = useUI((s) => s.selectedStashFile);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null);
  const setView = useUI((s) => s.setView);
  const columns = useSettings((s) => s.graphColumns);
  const hoveredBranch = useUI((s) => s.hoveredBranch);
  const inspectorWidth = useSettings((s) => s.inspectorWidth);
  const setInspectorWidth = useSettings((s) => s.setInspectorWidth);

  // After a refresh, the previously-selected commit may be gone (e.g. it
  // got squashed by a rebase, dropped by a reset, or otherwise rewritten).
  // Clear the selection so the right pane falls back to the changes view
  // instead of sticking on a detail panel for a missing hash.
  useEffect(() => {
    if (selected && !commits.some((c) => c.hash === selected)) {
      selectCommit(null);
    }
    if (selectedCommitFile && !commits.some((c) => c.hash === selectedCommitFile.hash)) {
      selectCommitFile(null);
    }
  }, [commits, selected, selectedCommitFile, selectCommit, selectCommitFile]);

  // Same idea for WIP file diffs: once a file leaves the staged/unstaged
  // list (staged, discarded, committed), close the diff so the user sees
  // the graph or changes panel rather than an empty frame.
  useEffect(() => {
    if (!selectedWipFile || !status) return;
    const pool = selectedWipFile.staged ? status.staged : status.unstaged;
    const stillThere = pool.some((f) => f.path === selectedWipFile.path);
    if (!stillThere) selectWipFile(null);
  }, [status, selectedWipFile, selectWipFile]);

  const layout = useMemo(() => layoutCommits(commits), [commits]);
  const graphColumnWidth = Math.max(
    120,
    GRAPH_INNER_PADDING + layout.laneCount * LANE_WIDTH + GRAPH_INNER_PADDING,
  );

  // Precompute which commits are on the hovered branch lineage so we can
  // fade unrelated commits — helps trace a branch's lineage at a glance.
  const highlighted = useMemo(() => {
    if (!hoveredBranch) return null;
    const tipNode = layout.nodes.find((n) => n.commit.refs.includes(hoveredBranch));
    if (!tipNode) return null;
    const hashToNode = new Map(layout.nodes.map((n) => [n.commit.hash, n]));
    const set = new Set<string>();
    const stack = [tipNode.commit.hash];
    while (stack.length) {
      const h = stack.pop()!;
      if (set.has(h)) continue;
      set.add(h);
      const n = hashToNode.get(h);
      if (!n) continue;
      for (const p of n.commit.parents) stack.push(p);
    }
    return set;
  }, [layout, hoveredBranch]);

  const changeCount = useWipCount(activePath);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedCommitFile ? (
          <CommitFileDiff
            hash={selectedCommitFile.hash}
            path={selectedCommitFile.path}
          />
        ) : selectedWipFile ? (
          <WipFileDiff path={selectedWipFile.path} staged={selectedWipFile.staged} />
        ) : selectedStashFile ? (
          <StashFileDiff
            index={selectedStashFile.index}
            path={selectedStashFile.path}
          />
        ) : (
          <>
            <ColumnHeaders graphColumnWidth={graphColumnWidth} columns={columns} />
            {changeCount > 0 && (
              <WipRow
                count={changeCount}
                graphColumnWidth={graphColumnWidth}
                columns={columns}
                onClick={() => {
                  // Selections already expose the inspector's WIP pane.
                  // Clear anything else so it slides into view.
                  useUI.getState().selectCommit(null);
                  useUI.getState().selectStash(null);
                }}
              />
            )}
            <GraphBody
              layout={layout}
              graphColumnWidth={graphColumnWidth}
              columns={columns}
              selected={selected}
              highlighted={highlighted}
              onSelect={selectCommit}
              onContextMenu={(x, y, commit) => setMenu({ x, y, commit })}
              hasMore={logQuery.hasNextPage}
              loadingMore={logQuery.isFetchingNextPage}
              onLoadMore={() => {
                void logQuery.fetchNextPage();
              }}
            />
          </>
        )}
      </div>
      <ResizeHandle
        onResize={(dx) => setInspectorWidth(inspectorWidth - dx)}
        side="left"
      />
      <div style={{ width: inspectorWidth }} className="shrink-0">
        {selectedStash != null ? (
          <StashDetail index={selectedStash} />
        ) : selected ? (
          <CommitDetail hash={selected} onClose={() => selectCommit(null)} />
        ) : (
          <ChangesPanel />
        )}
      </div>
      {menu &&
        (menu.commit.refs.some((r) => r === "stash" || r === "refs/stash") ? (
          <StashContextMenu
            x={menu.x}
            y={menu.y}
            commit={menu.commit}
            onClose={() => setMenu(null)}
          />
        ) : (
          <CommitContextMenu
            x={menu.x}
            y={menu.y}
            commit={menu.commit}
            onClose={() => setMenu(null)}
          />
        ))}
    </div>
  );
}

function ColumnHeaders({
  graphColumnWidth,
  columns,
}: {
  graphColumnWidth: number;
  columns: GraphColumns;
}) {
  const setGraphColumn = useSettings((s) => s.setGraphColumn);

  return (
    <div className="flex h-7 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-925 text-[10px] uppercase tracking-wider text-neutral-500">
      <ColHead width={REFS_COL_WIDTH}>Branch / Tag</ColHead>
      <ColHead width={graphColumnWidth}>Graph</ColHead>
      <ColHead flex>Commit Message</ColHead>
      {columns.author && <ColHead width={AUTHOR_COL_WIDTH}>Author</ColHead>}
      {columns.date && <ColHead width={DATE_COL_WIDTH}>Date</ColHead>}
      {columns.sha && <ColHead width={SHA_COL_WIDTH}>SHA</ColHead>}
      <div className="ml-auto flex items-center pr-2">
        <Menu.Root modal={false}>
          <Menu.Trigger
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="Graph columns"
          >
            <SettingsIcon className="size-3.5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              side="bottom"
              align="end"
              sideOffset={4}
              className="z-50 outline-none"
            >
              <Menu.Popup className="min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 text-[11px] shadow-lg outline-none">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
                  Columns
                </div>
                {([
                  ["author", "Author"],
                  ["date", "Date"],
                  ["sha", "SHA"],
                ] as const).map(([k, label]) => (
                  <Menu.CheckboxItem
                    key={k}
                    checked={columns[k]}
                    onCheckedChange={(checked) => setGraphColumn(k, checked)}
                    className="flex cursor-default items-center gap-2 px-3 py-1.5 normal-case tracking-normal outline-none data-[highlighted]:bg-neutral-800"
                  >
                    <span className="flex size-3 items-center justify-center rounded-sm border border-neutral-600 bg-neutral-800">
                      <Menu.CheckboxItemIndicator className="text-indigo-400">
                        <CheckIcon className="size-2.5" />
                      </Menu.CheckboxItemIndicator>
                    </span>
                    <span>{label}</span>
                  </Menu.CheckboxItem>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

function ColHead({
  children,
  width,
  flex,
}: {
  children: React.ReactNode;
  width?: number;
  flex?: boolean;
}) {
  return (
    <div
      className={`flex items-center border-r border-neutral-800 px-3 ${flex ? "flex-1" : ""}`}
      style={width ? { width } : undefined}
    >
      {children}
    </div>
  );
}

function WipRow({
  count,
  graphColumnWidth,
  columns,
  onClick,
}: {
  count: number;
  graphColumnWidth: number;
  columns: GraphColumns;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="group flex h-7 shrink-0 cursor-pointer items-center border-b border-neutral-800 bg-cyan-500/5 hover:bg-cyan-500/10"
    >
      <div
        className="flex h-full items-center border-r border-neutral-800 pl-3"
        style={{ width: REFS_COL_WIDTH }}
      >
        <div className="h-5 w-1 rounded-sm bg-cyan-500" />
      </div>
      <div
        className="relative h-full border-r border-neutral-800"
        style={{ width: graphColumnWidth }}
      >
        <div className="absolute inset-0 flex items-center pl-3">
          <PlusIcon className="size-3 text-cyan-500" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-between px-3 text-sm">
        <span className="text-cyan-300">Uncommitted changes</span>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">
          {count}
        </span>
      </div>
      {columns.author && <div style={{ width: AUTHOR_COL_WIDTH }} />}
      {columns.date && <div style={{ width: DATE_COL_WIDTH }} />}
      {columns.sha && <div style={{ width: SHA_COL_WIDTH }} />}
    </div>
  );
}

function GraphBody({
  layout,
  graphColumnWidth,
  columns,
  selected,
  highlighted,
  onSelect,
  onContextMenu,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  layout: GraphLayout;
  graphColumnWidth: number;
  columns: GraphColumns;
  selected: string | null;
  highlighted: Set<string> | null;
  onSelect: (hash: string) => void;
  onContextMenu: (x: number, y: number, commit: Commit) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // rAF-throttle scroll updates: without this, each scroll event would
    // trigger a React re-render that re-projects the visible window,
    // and on huge repos that's enough to melt the renderer. With rAF we
    // coalesce into one update per frame.
    const onScroll = () => {
      if (rafId.current != null) return;
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = null;
        setScrollTop(el.scrollTop);
      });
      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (remaining < ROW_HEIGHT * 20 && hasMore && !loadingMore) {
        onLoadMore();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [onLoadMore, hasMore, loadingMore]);

  const OVERSCAN = 20;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRow = Math.min(
    layout.nodes.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleNodes = layout.nodes.slice(firstRow, lastRow);

  // Only render SVG elements that intersect the visible window. On a
  // 10k-commit repo the previous "render every edge + circle" approach
  // created tens of thousands of SVG nodes which tanked scroll perf and
  // eventually crashed the renderer; keeping just the visible slice
  // means we render ~120 elements regardless of history size.
  const { visibleEdges, visibleCircles, svgYOffset } = useMemo(() => {
    const from = firstRow;
    const to = lastRow;
    const edges = layout.edges.filter((e) => {
      const top = Math.min(e.fromRow, e.toRow);
      const bottom = Math.max(e.fromRow, e.toRow);
      return bottom >= from && top <= to;
    });
    const circles = layout.nodes.slice(from, to);
    return {
      visibleEdges: edges,
      visibleCircles: circles,
      svgYOffset: from * ROW_HEIGHT,
    };
  }, [layout, firstRow, lastRow]);

  const totalHeight = layout.nodes.length * ROW_HEIGHT;
  const svgHeight = (lastRow - firstRow) * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto">
      <div style={{ height: totalHeight + 40, position: "relative" }}>
        <svg
          width={graphColumnWidth}
          height={svgHeight}
          viewBox={`0 ${svgYOffset} ${graphColumnWidth} ${svgHeight}`}
          style={{
            position: "absolute",
            left: REFS_COL_WIDTH,
            top: svgYOffset,
            pointerEvents: "none",
          }}
        >
          {visibleEdges.map((e, i) => (
            <Edge
              key={i}
              edge={e}
              faded={highlighted != null && !highlighted.has(edgeKey(e, layout))}
            />
          ))}
          {visibleCircles.map((n) => (
            <circle
              key={n.commit.hash}
              cx={GRAPH_INNER_PADDING + n.lane * LANE_WIDTH}
              cy={n.row * ROW_HEIGHT + ROW_HEIGHT / 2}
              r={CIRCLE_R}
              fill={n.color}
              stroke="#0a0a0a"
              strokeWidth={1.5}
              opacity={highlighted && !highlighted.has(n.commit.hash) ? 0.3 : 1}
            />
          ))}
        </svg>
        {visibleNodes.map((n) => (
          <CommitRow
            key={n.commit.hash}
            node={n}
            selected={selected === n.commit.hash}
            faded={highlighted != null && !highlighted.has(n.commit.hash)}
            graphColumnWidth={graphColumnWidth}
            columns={columns}
            onClick={() => onSelect(n.commit.hash)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(e.clientX, e.clientY, n.commit);
            }}
          />
        ))}
        {hasMore && (
          <div
            className="absolute flex items-center justify-center text-xs text-neutral-500"
            style={{ top: totalHeight, left: 0, right: 0, height: 40 }}
          >
            {loadingMore ? "Loading more commits…" : "Scroll to load more"}
          </div>
        )}
      </div>
    </div>
  );
}

// Cache the reverse lookup: which commit hash does each edge emerge from?
// We use this to decide whether an edge belongs to the highlighted lineage.
function edgeKey(e: GraphLayout["edges"][number], layout: GraphLayout): string {
  return layout.nodes[e.fromRow]?.commit.hash ?? "";
}

function Edge({
  edge,
  faded,
}: {
  edge: GraphLayout["edges"][number];
  faded: boolean;
}) {
  const x1 = GRAPH_INNER_PADDING + edge.fromLane * LANE_WIDTH;
  const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = GRAPH_INNER_PADDING + edge.toLane * LANE_WIDTH;
  const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const opacity = faded ? 0.25 : 1;
  if (x1 === x2) {
    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={edge.color}
        strokeWidth={2}
        opacity={opacity}
      />
    );
  }
  const d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
  return (
    <path d={d} stroke={edge.color} strokeWidth={2} fill="none" opacity={opacity} />
  );
}

function CommitRow({
  node,
  selected,
  faded,
  graphColumnWidth,
  columns,
  onClick,
  onContextMenu,
}: {
  node: GraphLayout["nodes"][number];
  selected: boolean;
  faded: boolean;
  graphColumnWidth: number;
  columns: GraphColumns;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const c = node.commit;
  const date = new Date(c.timestamp * 1000);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: node.row * ROW_HEIGHT,
        height: ROW_HEIGHT,
        opacity: faded ? 0.35 : 1,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex cursor-pointer text-sm transition-opacity ${
        selected ? "bg-indigo-500/15" : "hover:bg-neutral-900/80"
      }`}
      title={`${c.hash} · ${c.author} · ${date.toLocaleString()}`}
    >
      <div
        className="flex items-center overflow-hidden px-2"
        style={{ width: REFS_COL_WIDTH }}
      >
        <RefBadges refs={c.refs} color={node.color} />
      </div>
      <div className="shrink-0" style={{ width: graphColumnWidth }} />
      <div className="flex min-w-0 flex-1 items-center px-3 text-neutral-200">
        <span className="min-w-0 truncate">{c.subject}</span>
      </div>
      {columns.author && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 text-xs text-neutral-400"
          style={{ width: AUTHOR_COL_WIDTH }}
        >
          <Avatar name={c.author} email={c.email} size={18} />
          <span className="truncate">{c.author}</span>
        </div>
      )}
      {columns.date && (
        <div
          className="flex shrink-0 items-center px-3 text-xs text-neutral-500"
          style={{ width: DATE_COL_WIDTH }}
          title={date.toLocaleString()}
        >
          {formatRelative(date)}
        </div>
      )}
      {columns.sha && (
        <div
          className="mono flex shrink-0 items-center px-3 text-xs text-neutral-600"
          style={{ width: SHA_COL_WIDTH }}
        >
          {c.hash.slice(0, 7)}
        </div>
      )}
    </div>
  );
}

function RefBadges({ refs, color }: { refs: string[]; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  // Delayed close lets the user travel from the refs cell into the popover
  // that sits a few pixels below it without the hover state collapsing
  // mid-movement. Re-entering (cell or popover) cancels the pending close.
  const closeTimer = useRef<number | null>(null);
  const activePath = useActiveTab()?.path;
  const remotes = useQuery(gitRemotesOptions(activePath)).data ?? [];

  // "HEAD" is redundant with the accompanying branch name on the same
  // commit and only clutters the list. Sort so branches (local first,
  // remote second) come before tags — they're the interactive items
  // users care about checking out.
  const ordered = useMemo(() => {
    const score = (r: string): number => {
      if (r.startsWith("tag:")) return 3;
      const slash = r.indexOf("/");
      if (slash > 0) {
        const maybeRemote = r.slice(0, slash);
        if (remotes.some((rem) => rem.name === maybeRemote)) return 2;
      }
      return 1; // local branch
    };
    return refs
      .filter((r) => r !== "HEAD")
      .slice()
      .sort((a, b) => score(a) - score(b));
  }, [refs, remotes]);

  // Portal the popover out of the commit row — the refs column has
  // `overflow-hidden` to trim long ref lists, which would otherwise clip
  // an absolutely-positioned popover. Rendering into document.body with
  // measured fixed coords sidesteps every ancestor's overflow rules.
  useLayoutEffect(() => {
    if (!expanded || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [expanded]);

  if (ordered.length === 0) return null;
  const MAX_VISIBLE = 1;
  const visible = ordered.slice(0, MAX_VISIBLE);
  const extra = ordered.length - MAX_VISIBLE;

  const openNow = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (extra > 0) setExpanded(true);
  };
  const closeSoon = () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setExpanded(false);
      closeTimer.current = null;
    }, 150);
  };

  return (
    <div
      ref={anchorRef}
      className="flex min-w-0 items-center gap-1"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      {visible.map((r) => (
        <RefBadge
          key={r}
          ref_={r}
          color={color}
          // While the popover is open we already show this ref in the
          // list below — stop truncating the inline badge so it no
          // longer looks different from the popover entry.
          truncate={!expanded}
        />
      ))}
      {extra > 0 && (
        <span
          className="shrink-0 cursor-pointer rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          title={ordered.join(", ")}
        >
          +{extra}
        </span>
      )}
      {expanded &&
        pos &&
        createPortal(
          <div
            onMouseEnter={openNow}
            onMouseLeave={closeSoon}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            // Subtle card backdrop behind the floating badges. Inner
            // padding (px-1.5 py-1) is offset from `left` so the first
            // pill aligns horizontally with the outer inline badge
            // that spawned the popover.
            className="gui-menu-in fixed z-50 flex max-w-[420px] flex-col items-start gap-1 rounded-md border border-neutral-800/80 bg-neutral-900/70 px-1.5 py-1 shadow-lg backdrop-blur-sm"
            style={{ top: pos.top, left: pos.left - 6 }}
          >
            {ordered.slice(MAX_VISIBLE).map((r) => (
              <RefBadge
                key={r}
                ref_={r}
                color={color}
                truncate={false}
                inPopover
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function RefBadge({
  ref_,
  color,
  truncate = true,
  inPopover,
}: {
  ref_: string;
  color: string;
  // When false, the ref label is never truncated. Used by the inline
  // badge while the popover is open so the text doesn't visually change
  // mid-interaction.
  truncate?: boolean;
  // Rendered inside the floating ref popover — enables the right-click
  // context menu and slightly bumps the hit-area so the badge is easy
  // to double-click.
  inPopover?: boolean;
}) {
  const setHovered = useUI((s) => s.setHoveredBranch);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const activePath = useActiveTab()?.path;
  const branches = useQuery(gitBranchesOptions(activePath)).data ?? [];
  const remotes = useQuery(gitRemotesOptions(activePath)).data ?? [];
  const checkoutMut = useMutation(checkoutMutation(activePath ?? ""));
  const checkoutCreateMut = useMutation(checkoutCreateMutation(activePath ?? ""));
  const resetMut = useMutation(resetMutation(activePath ?? ""));

  // After parser normalization, refs come in short form:
  //   tag:<name>          — tag
  //   <remote>/<branch>   — remote branch (first segment matches a configured remote)
  //   <name>              — local branch
  //   stash / refs/stash  — a stash ref (rarely appears via --all but can)
  // Matching against the actual remote list (rather than guessing off "/")
  // correctly classifies a local branch whose name happens to contain a
  // slash (e.g. `feature/login`) as local.
  const isTag = ref_.startsWith("tag:");
  const isStash = ref_ === "stash" || ref_ === "refs/stash";
  let label = ref_;
  let remoteName: string | null = null;
  let kind: "tag" | "remote" | "local" | "stash" = "local";
  if (isTag) {
    kind = "tag";
    label = ref_.slice(4);
  } else if (isStash) {
    kind = "stash";
    label = "stash";
  } else {
    const slash = ref_.indexOf("/");
    if (slash > 0) {
      const maybeRemote = ref_.slice(0, slash);
      if (remotes.some((r) => r.name === maybeRemote)) {
        kind = "remote";
        remoteName = maybeRemote;
        label = ref_.slice(slash + 1);
      }
    }
  }
  const remote = remoteName ? remotes.find((r) => r.name === remoteName) : null;
  const branchName = kind === "stash" ? null : kind === "tag" ? label : ref_;
  // Only offer checkout for refs that actually exist in the current
  // branch list (tags always accept `git checkout <tag>` which lands in
  // detached HEAD — the user opts into that from the menu). Guards
  // against stale decorations pointing at refs the user has since
  // deleted.
  const canCheckout =
    !!branchName &&
    (kind === "tag" || branches.some((b) => b.name === branchName));

  async function checkout(e: React.MouseEvent) {
    e.stopPropagation();
    if (!branchName) return;

    // Tag — checkout lands in a detached HEAD. Warn once so the user
    // knows what they're opting into.
    if (kind === "tag") {
      const ok = await confirmDialog({
        title: `Checkout ${branchName}`,
        message: `Checking out a tag puts the repo in detached HEAD.\nCommits you make after this won't belong to any branch.`,
        confirmLabel: "Checkout",
      });
      if (!ok) return;
      try {
        await checkoutMut.mutateAsync(branchName);
        toast("info", `Detached HEAD at ${branchName}`);
      } catch (err) {
        toast("error", err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Local branch — straight checkout.
    if (kind === "local") {
      try {
        await checkoutMut.mutateAsync(branchName);
        toast("success", `Switched to ${branchName}`);
      } catch (err) {
        toast("error", err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Remote branch — avoid landing in detached HEAD. Prefer the matching
    // local branch if one exists, creating it with the remote as upstream
    // when it doesn't. If the local copy diverges we offer to reset it to
    // the remote's tip.
    const localName = label;
    const localBranch = branches.find((b) => b.name === localName && b.isLocal);
    const remoteBranch = branches.find((b) => b.name === branchName && b.isRemote);

    try {
      if (!localBranch) {
        await checkoutCreateMut.mutateAsync({ name: localName, startPoint: branchName });
        toast("success", `Created local branch ${localName}`);
      } else {
        const sameHead =
          localBranch.lastCommit &&
          remoteBranch?.lastCommit &&
          localBranch.lastCommit === remoteBranch.lastCommit;
        if (!sameHead) {
          const doReset = await confirmDialog({
            title: `Switch to ${localName}`,
            message: `Local branch "${localName}" is at a different commit than ${branchName}.\n\nReset local to the remote's HEAD?`,
            confirmLabel: "Reset and switch",
            cancelLabel: "Switch without reset",
            danger: true,
          });
          await checkoutMut.mutateAsync(localName);
          if (doReset) {
            await resetMut.mutateAsync({ target: branchName, mode: "hard" });
            toast("success", `Switched to ${localName} (reset to ${branchName})`);
          } else {
            toast("success", `Switched to ${localName}`);
          }
        } else {
          await checkoutMut.mutateAsync(localName);
          toast("success", `Switched to ${localName}`);
        }
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!branchName || !canCheckout) return;
    e.stopPropagation();
    void checkout(e);
  };

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHoveredLocal] = useState(false);
  const onContextMenu = (e: React.MouseEvent) => {
    if (!canCheckout) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // Branch entry used by the full BranchContextMenu. Tags and stashes
  // don't map onto a `Branch` record so the menu falls back to a
  // lightweight per-kind menu for them.
  const branchEntry =
    kind === "local" || kind === "remote"
      ? branches.find((b) => b.name === branchName)
      : null;

  return (
    <>
      <span
        onMouseEnter={() => {
          setHoveredLocal(true);
          if (kind !== "tag") setHovered(ref_);
        }}
        onMouseLeave={() => {
          setHoveredLocal(false);
          setHovered(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        className={`inline-flex min-w-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
          canCheckout ? "cursor-pointer" : ""
        } ${inPopover ? "shadow-sm" : ""}`}
        // Translucent pills tinted by the branch color, bumped from
        // ~20% to ~33% alpha on hover so the badge lights up without
        // flipping to a fully opaque block.
        style={{
          backgroundColor: `${color}${hovered ? "55" : "33"}`,
          color: "#e5e5e5",
        }}
        title={canCheckout ? `Double-click to checkout ${branchName}` : ref_}
      >
        {kind === "tag" ? (
          <TagIcon className="size-3.5 shrink-0" />
        ) : kind === "stash" ? (
          <StashIcon className="size-4 shrink-0 text-neutral-300" />
        ) : kind === "remote" && remote ? (
          <RemoteAvatar url={remote.fetchUrl} size={16} />
        ) : kind === "remote" ? (
          <RemoteIcon className="size-4 shrink-0" />
        ) : (
          <ComputerIcon className="size-4 shrink-0 text-neutral-300" />
        )}
        <span className={truncate ? "truncate" : "whitespace-nowrap"}>{label}</span>
      </span>
      {menu && branchEntry && (
        <RefBranchMenuHost
          x={menu.x}
          y={menu.y}
          branch={branchEntry}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && !branchEntry && branchName && (
        <TagOrStashMenu
          x={menu.x}
          y={menu.y}
          refName={branchName}
          kind={kind}
          onClose={() => setMenu(null)}
          onCheckout={async () => {
            setMenu(null);
            await checkout(new MouseEvent("click") as unknown as React.MouseEvent);
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(branchName);
            setMenu(null);
            toast("success", "Copied ref name");
          }}
        />
      )}
    </>
  );
}

// Hosts BranchContextMenu so we can drive its merge/rebase/rename/PR
// dialogs locally without lifting them up to BranchGraph — each ref
// badge owns its own menu lifecycle. Portals sidestep the commit row's
// overflow-hidden refs column.
//
// Menu visibility is tracked internally so that dismissing the menu after
// clicking an action (Merge, Rebase, …) doesn't also tear down the host
// — if it did, the follow-up dialog state would be dropped before it
// could render. The host only reports fully-closed to its parent once
// the menu is hidden AND no dialogs remain open.
function RefBranchMenuHost({
  x,
  y,
  branch,
  onClose,
}: {
  x: number;
  y: number;
  branch: import("@shared/types").Branch;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [mergeDialog, setMergeDialog] = useState<
    { kind: "merge" | "rebase"; source: string } | null
  >(null);
  const [renaming, setRenaming] = useState<import("@shared/types").Branch | null>(null);
  const [prHead, setPrHead] = useState<string | null>(null);
  const [createFromBase, setCreateFromBase] = useState<string | null>(null);
  const activePath = useActiveTab()?.path;
  const branchRenameMut = useMutation(branchRenameMutation(activePath ?? ""));
  const mergeMut = useMutation(mergeMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const setView = useUI((s) => s.setView);

  useEffect(() => {
    if (!menuOpen && !mergeDialog && !renaming && !prHead && !createFromBase) {
      onClose();
    }
  }, [menuOpen, mergeDialog, renaming, prHead, createFromBase, onClose]);

  // Merge runs immediately (no confirmation dialog) — it's reversible via
  // `merge --abort` until committed, and any prompt adds friction to the
  // common case. Rebase still goes through the dialog because it rewrites
  // history and is harder to undo.
  async function runMerge(source: string) {
    setMenuOpen(false);
    try {
      const result = await mergeMut.mutateAsync(source);
      if (result.conflicts.length > 0) {
        toast("info", `Conflicts in ${result.conflicts.length} file(s)`);
        setView("merge");
      } else {
        toast("success", `Merged ${source}`);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRename(newName: string) {
    const target = renaming;
    setRenaming(null);
    if (!target || newName === target.name) return;
    try {
      await branchRenameMut.mutateAsync({ oldName: target.name, newName });
      toast("success", `Renamed to ${newName}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return createPortal(
    <>
      {menuOpen && (
        <BranchContextMenu
          x={x}
          y={y}
          branch={branch}
          onClose={() => setMenuOpen(false)}
          onMerge={(src) => void runMerge(src)}
          onRebase={(src) => setMergeDialog({ kind: "rebase", source: src })}
          onRename={(b) => setRenaming(b)}
          onOpenPR={(b) => setPrHead(b.name)}
          onCreateBranch={(base) => setCreateFromBase(base)}
        />
      )}
      {mergeDialog && (
        <MergeRebaseDialog
          kind={mergeDialog.kind}
          source={mergeDialog.source}
          onClose={() => setMergeDialog(null)}
        />
      )}
      {createFromBase && (
        <BranchCreateDialog
          initialBase={createFromBase}
          onClose={() => setCreateFromBase(null)}
        />
      )}
      {renaming && (
        <Prompt
          title="Rename Branch"
          label="New name"
          defaultValue={renaming.name}
          submitLabel="Rename"
          onSubmit={handleRename}
          onCancel={() => setRenaming(null)}
        />
      )}
      {prHead && <PRCreateDialog headBranch={prHead} onClose={() => setPrHead(null)} />}
    </>,
    document.body,
  );
}

function TagOrStashMenu({
  x,
  y,
  refName,
  kind,
  onClose,
  onCheckout,
  onCopy,
}: {
  x: number;
  y: number;
  refName: string;
  kind: "tag" | "stash" | "remote" | "local";
  onClose: () => void;
  onCheckout: () => void;
  onCopy: () => void;
}) {
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );
  return (
    <Menu.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
    >
      <Menu.Portal>
        <Menu.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={0}
          className="z-50 outline-none"
        >
          <Menu.Popup className="gui-menu-in min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 text-sm shadow-xl outline-none">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
              {refName}
            </div>
            {kind !== "stash" && (
              <Menu.Item
                onClick={onCheckout}
                className="block w-full cursor-default px-3 py-1.5 text-left text-neutral-200 outline-none data-[highlighted]:bg-neutral-800"
              >
                Checkout
              </Menu.Item>
            )}
            <Menu.Item
              onClick={onCopy}
              className="block w-full cursor-default px-3 py-1.5 text-left text-neutral-200 outline-none data-[highlighted]:bg-neutral-800"
            >
              Copy name
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}


// "5m", "3h", "2d", "1w", "6mo", "1y" — compact relative time for the date column.
function formatRelative(d: Date): string {
  const delta = (Date.now() - d.getTime()) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
  if (delta < 86400 * 30) return `${Math.floor(delta / (86400 * 7))}w ago`;
  if (delta < 86400 * 365) return `${Math.floor(delta / (86400 * 30))}mo ago`;
  return `${Math.floor(delta / (86400 * 365))}y ago`;
}
