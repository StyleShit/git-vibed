import { useEffect, useMemo, useRef, useState } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { layoutCommits, type GraphLayout } from "../../lib/graph-layout";
import { CommitDetail } from "./CommitDetail";
import { CommitContextMenu } from "./CommitContextMenu";
import type { Commit } from "@shared/types";

// GitKraken-ish three-column layout: refs | graph | message. The SVG graph
// overlays the middle column; commit rows are absolutely positioned so we
// can virtualize.
const ROW_HEIGHT = 26;
const LANE_WIDTH = 14;
const CIRCLE_R = 4;
const GRAPH_INNER_PADDING = 12;
const REFS_COL_WIDTH = 220;

export function BranchGraph() {
  const commits = useActive("commits") ?? [];
  const status = useActive("status");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null);
  const setView = useUI((s) => s.setView);

  const layout = useMemo(() => layoutCommits(commits), [commits]);
  const graphColumnWidth = Math.max(
    120,
    GRAPH_INNER_PADDING + layout.laneCount * LANE_WIDTH + GRAPH_INNER_PADDING,
  );

  const changeCount =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.conflicted.length ?? 0);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <ColumnHeaders graphColumnWidth={graphColumnWidth} />
        {changeCount > 0 && (
          <WipRow
            count={changeCount}
            graphColumnWidth={graphColumnWidth}
            onClick={() => setView("changes")}
          />
        )}
        <GraphBody
          layout={layout}
          graphColumnWidth={graphColumnWidth}
          selected={selected}
          onSelect={setSelected}
          onContextMenu={(x, y, commit) => setMenu({ x, y, commit })}
        />
      </div>
      {selected && <CommitDetail hash={selected} onClose={() => setSelected(null)} />}
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

function ColumnHeaders({ graphColumnWidth }: { graphColumnWidth: number }) {
  return (
    <div className="flex h-7 shrink-0 border-b border-neutral-800 bg-neutral-925 text-[10px] uppercase tracking-wider text-neutral-500">
      <div
        className="flex items-center border-r border-neutral-800 px-3"
        style={{ width: REFS_COL_WIDTH }}
      >
        Branch / Tag
      </div>
      <div
        className="flex items-center border-r border-neutral-800 px-3"
        style={{ width: graphColumnWidth }}
      >
        Graph
      </div>
      <div className="flex flex-1 items-center px-3">Commit Message</div>
    </div>
  );
}

function WipRow({
  count,
  graphColumnWidth,
  onClick,
}: {
  count: number;
  graphColumnWidth: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex h-7 shrink-0 cursor-pointer items-center border-b border-neutral-800 bg-neutral-950 hover:bg-neutral-900"
    >
      <div
        className="flex items-center border-r border-neutral-800 pl-3"
        style={{ width: REFS_COL_WIDTH }}
      >
        {/* Narrow leading bar — mirrors the current-branch accent in the
            screenshot so WIP reads as the "row you'd land on if you commit". */}
        <div className="h-5 w-1 rounded-sm bg-cyan-500" />
      </div>
      <div
        className="h-full border-r border-neutral-800 bg-cyan-500/10"
        style={{ width: graphColumnWidth }}
      />
      <div className="flex flex-1 items-center justify-between px-3">
        <span className="mono text-sm text-neutral-300">// WIP</span>
        <span className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300">
          <PencilIcon />
          {count}
        </span>
      </div>
    </div>
  );
}

function GraphBody({
  layout,
  graphColumnWidth,
  selected,
  onSelect,
  onContextMenu,
}: {
  layout: GraphLayout;
  graphColumnWidth: number;
  selected: string | null;
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
      // Infinite scroll — trigger a load when we're within ~20 rows of the
      // bottom. The store guards against re-entrance so spamming the event
      // is safe.
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
        {/* SVG positioned at the graph column's left edge so lanes live
            inside that column regardless of the message column width. */}
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
            <Edge key={i} edge={e} />
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
            />
          ))}
        </svg>
        {visibleNodes.map((n) => (
          <CommitRow
            key={n.commit.hash}
            node={n}
            selected={selected === n.commit.hash}
            graphColumnWidth={graphColumnWidth}
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

function Edge({ edge }: { edge: GraphLayout["edges"][number] }) {
  const x1 = GRAPH_INNER_PADDING + edge.fromLane * LANE_WIDTH;
  const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = GRAPH_INNER_PADDING + edge.toLane * LANE_WIDTH;
  const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  if (x1 === x2) {
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={edge.color} strokeWidth={2} />;
  }
  const d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
  return <path d={d} stroke={edge.color} strokeWidth={2} fill="none" />;
}

function CommitRow({
  node,
  selected,
  graphColumnWidth,
  onClick,
  onContextMenu,
}: {
  node: GraphLayout["nodes"][number];
  selected: boolean;
  graphColumnWidth: number;
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
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex cursor-pointer text-sm ${
        selected ? "bg-neutral-800" : "hover:bg-neutral-900/80"
      }`}
      title={`${c.hash} · ${c.author} · ${date.toLocaleString()}`}
    >
      {/* Refs column */}
      <div
        className="flex items-center overflow-hidden px-2"
        style={{ width: REFS_COL_WIDTH }}
      >
        <RefBadges refs={c.refs} color={node.color} />
      </div>
      {/* Graph column: empty — SVG draws here */}
      <div className="shrink-0" style={{ width: graphColumnWidth }} />
      {/* Message column */}
      <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
        <span className="min-w-0 flex-1 truncate text-neutral-200">{c.subject}</span>
        <span className="shrink-0 text-xs text-neutral-500">{c.author}</span>
        <span className="mono shrink-0 text-xs text-neutral-600">{c.hash.slice(0, 7)}</span>
      </div>
    </div>
  );
}

// Render the first few refs attached to a commit as colored badges.
// Overflow collapses into a "+N" indicator to keep the column width stable.
function RefBadges({ refs, color }: { refs: string[]; color: string }) {
  if (refs.length === 0) return null;
  const MAX_VISIBLE = 1;
  const visible = refs.slice(0, MAX_VISIBLE);
  const extra = refs.length - MAX_VISIBLE;
  return (
    <div className="flex min-w-0 items-center gap-1">
      {visible.map((r) => (
        <RefBadge key={r} ref_={r} color={color} />
      ))}
      {extra > 0 && (
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[10px] text-neutral-400"
          title={refs.join(", ")}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function RefBadge({ ref_, color }: { ref_: string; color: string }) {
  const isTag = ref_.startsWith("tag:");
  const isRemote = ref_.includes("/") && !isTag && !ref_.startsWith("HEAD");
  const label = isTag ? ref_.slice(4) : ref_;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
      style={{ backgroundColor: `${color}33`, color: "#e5e5e5" }}
      title={ref_}
    >
      {isTag ? <TagIcon /> : isRemote ? <RemoteIcon /> : <BranchIcon />}
      <span className="truncate">{label}</span>
    </span>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 shrink-0" fill="currentColor" aria-hidden>
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11" cy="7" r="1.5" />
      <path d="M5 4v8M5 7h2a4 4 0 014-4" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
function RemoteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 shrink-0" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="8" cy="8" r="1.5" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M2 4l5-2 7 7-5 5-7-7V4z" fillOpacity="0.25" stroke="currentColor" strokeWidth="1" />
      <circle cx="5" cy="5" r="1" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 14l3-1 8-8-2-2-8 8z" />
      <path d="M11 3l2 2" />
    </svg>
  );
}
