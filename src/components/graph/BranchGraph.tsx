import { useEffect, useMemo, useRef, useState } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI, type GraphColumns } from "../../stores/ui";
import { layoutCommits, type GraphLayout } from "../../lib/graph-layout";
import { CommitDetail } from "./CommitDetail";
import { CommitContextMenu } from "./CommitContextMenu";
import { ChangesPanel } from "./ChangesPanel";
import { StashDetail } from "../stashes/StashDetail";
import { CommitFileDiff } from "./CommitFileDiff";
import { WipFileDiff } from "./WipFileDiff";
import { ResizeHandle } from "../ui/ResizeHandle";
import { useSettings } from "../../stores/settings";
import { BranchIcon, RemoteIcon, TagIcon, SettingsIcon, PlusIcon } from "../ui/Icons";
import { Avatar, RemoteAvatar } from "../ui/Avatar";
import type { Commit } from "@shared/types";

// GitKraken-style columns: refs | graph | message | author | date | sha.
// Columns after "message" are toggleable via the gear menu in the header.
const ROW_HEIGHT = 26;
const LANE_WIDTH = 14;
const CIRCLE_R = 4;
const GRAPH_INNER_PADDING = 12;
const REFS_COL_WIDTH = 220;
const AUTHOR_COL_WIDTH = 140;
const DATE_COL_WIDTH = 110;
const SHA_COL_WIDTH = 70;

export function BranchGraph() {
  const commits = useActive("commits") ?? [];
  const status = useActive("status");
  const selected = useUI((s) => s.selectedCommit);
  const selectedStash = useUI((s) => s.selectedStash);
  const selectCommit = useUI((s) => s.selectCommit);
  const selectedCommitFile = useUI((s) => s.selectedCommitFile);
  const selectedWipFile = useUI((s) => s.selectedWipFile);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null);
  const setView = useUI((s) => s.setView);
  const columns = useUI((s) => s.graphColumns);
  const hoveredBranch = useUI((s) => s.hoveredBranch);
  const inspectorWidth = useSettings((s) => s.inspectorWidth);
  const setInspectorWidth = useSettings((s) => s.setInspectorWidth);

  const layout = useMemo(() => layoutCommits(commits), [commits]);
  const graphColumnWidth = Math.max(
    120,
    GRAPH_INNER_PADDING + layout.laneCount * LANE_WIDTH + GRAPH_INNER_PADDING,
  );

  // Precompute which commits are on the hovered branch lineage so we can
  // fade unrelated commits. GitKraken calls this "Commit Highlighting".
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

  const changeCount =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.conflicted.length ?? 0);

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
      {menu && (
        <CommitContextMenu
          x={menu.x}
          y={menu.y}
          commit={menu.commit}
          onClose={() => setMenu(null)}
        />
      )}
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
  const [gearOpen, setGearOpen] = useState(false);
  const setGraphColumn = useUI((s) => s.setGraphColumn);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gearOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [gearOpen]);

  return (
    <div className="flex h-7 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-925 text-[10px] uppercase tracking-wider text-neutral-500">
      <ColHead width={REFS_COL_WIDTH}>Branch / Tag</ColHead>
      <ColHead width={graphColumnWidth}>Graph</ColHead>
      <ColHead flex>Commit Message</ColHead>
      {columns.author && <ColHead width={AUTHOR_COL_WIDTH}>Author</ColHead>}
      {columns.date && <ColHead width={DATE_COL_WIDTH}>Date</ColHead>}
      {columns.sha && <ColHead width={SHA_COL_WIDTH}>SHA</ColHead>}
      <div className="relative ml-auto flex items-center pr-2" ref={ref}>
        <button
          onClick={() => setGearOpen((v) => !v)}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          title="Graph columns"
        >
          <SettingsIcon className="size-3.5" />
        </button>
        {gearOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 text-[11px] shadow-lg">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
              Columns
            </div>
            {([
              ["author", "Author"],
              ["date", "Date"],
              ["sha", "SHA"],
            ] as const).map(([k, label]) => (
              <label
                key={k}
                className="flex items-center gap-2 px-3 py-1.5 normal-case tracking-normal hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={columns[k]}
                  onChange={(e) => setGraphColumn(k, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
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
}: {
  layout: GraphLayout;
  graphColumnWidth: number;
  columns: GraphColumns;
  selected: string | null;
  highlighted: Set<string> | null;
  onSelect: (hash: string) => void;
  onContextMenu: (x: number, y: number, commit: Commit) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const loadMoreCommits = useRepo((s) => s.loadMoreCommits);
  const commitsExhausted = useActive("commitsExhausted") ?? false;
  const loadingMore = useActive("loadingMoreCommits") ?? false;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrollTop(el.scrollTop);
      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (remaining < ROW_HEIGHT * 20 && !commitsExhausted && !loadingMore) {
        void loadMoreCommits();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [loadMoreCommits, commitsExhausted, loadingMore]);

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const lastRow = Math.min(
    layout.nodes.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 10,
  );
  const visibleNodes = layout.nodes.slice(firstRow, lastRow);

  const totalHeight = layout.nodes.length * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto">
      <div style={{ height: totalHeight + 40, position: "relative" }}>
        <svg
          width={graphColumnWidth}
          height={totalHeight}
          style={{
            position: "absolute",
            left: REFS_COL_WIDTH,
            top: 0,
            pointerEvents: "none",
          }}
        >
          {layout.edges.map((e, i) => (
            <Edge
              key={i}
              edge={e}
              faded={highlighted != null && !highlighted.has(edgeKey(e, layout))}
            />
          ))}
          {layout.nodes.map((n) => (
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
        {!commitsExhausted && (
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
  if (refs.length === 0) return null;
  const MAX_VISIBLE = 1;
  const visible = refs.slice(0, MAX_VISIBLE);
  const extra = refs.length - MAX_VISIBLE;

  // Hovering the row (anywhere in the refs cell) pops a floating list of all
  // attached refs. Absolute positioning lets the popover escape the 220px
  // refs column so long branch names stay readable.
  return (
    <div
      className="relative flex min-w-0 items-center gap-1"
      onMouseEnter={() => extra > 0 && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {visible.map((r) => (
        <RefBadge key={r} ref_={r} color={color} />
      ))}
      {extra > 0 && (
        <span
          className="shrink-0 cursor-pointer rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          title={refs.join(", ")}
        >
          +{extra}
        </span>
      )}
      {expanded && (
        <div className="absolute left-0 top-full z-30 mt-1 flex max-w-[420px] flex-wrap gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1.5 shadow-lg">
          {refs.map((r) => (
            <RefBadge key={r} ref_={r} color={color} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefBadge({ ref_, color }: { ref_: string; color: string }) {
  const setHovered = useUI((s) => s.setHoveredBranch);
  const remotes = useActive("remotes") ?? [];
  const isTag = ref_.startsWith("tag:");
  const isRemote = ref_.includes("/") && !isTag && !ref_.startsWith("HEAD");

  // For "origin/main" style refs we strip the remote prefix and render a
  // remote avatar badge in its place. Cleaner than long "origin/foo/bar"
  // labels and matches GitKraken's compact ref display.
  let label = ref_;
  let remoteName: string | null = null;
  if (isTag) {
    label = ref_.slice(4);
  } else if (isRemote) {
    const slash = ref_.indexOf("/");
    remoteName = ref_.slice(0, slash);
    label = ref_.slice(slash + 1);
  }
  const remote = remoteName ? remotes.find((r) => r.name === remoteName) : null;

  return (
    <span
      onMouseEnter={() => !isTag && setHovered(ref_)}
      onMouseLeave={() => setHovered(null)}
      className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
      style={{ backgroundColor: `${color}33`, color: "#e5e5e5" }}
      title={ref_}
    >
      {isTag ? (
        <TagIcon className="size-2.5 shrink-0" />
      ) : remote ? (
        <RemoteAvatar url={remote.fetchUrl} size={10} />
      ) : isRemote ? (
        <RemoteIcon className="size-2.5 shrink-0" />
      ) : (
        <BranchIcon className="size-2.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}


// "5m", "3h", "2d", "1w", "6mo", "1y" — compact like GitKraken's date column.
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
