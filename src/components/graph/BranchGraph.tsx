import { useEffect, useMemo, useRef, useState } from "react";
import { useActive } from "../../stores/repo";
import { layoutCommits, type GraphLayout } from "../../lib/graph-layout";
import { CommitDetail } from "./CommitDetail";
import { CommitContextMenu } from "./CommitContextMenu";
import type { Commit } from "@shared/types";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const CIRCLE_R = 4;
const GRAPH_PADDING_LEFT = 12;

export function BranchGraph() {
  const commits = useActive("commits") ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null);

  const layout = useMemo(() => layoutCommits(commits), [commits]);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <GraphHeader count={commits.length} />
        <GraphBody
          layout={layout}
          selected={selected}
          onSelect={setSelected}
          onContextMenu={(x, y, commit) => setMenu({ x, y, commit })}
        />
      </div>
      {selected && (
        <CommitDetail hash={selected} onClose={() => setSelected(null)} />
      )}
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

function GraphHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
      <span>{count} commits</span>
    </div>
  );
}

function GraphBody({
  layout,
  selected,
  onSelect,
  onContextMenu,
}: {
  layout: GraphLayout;
  selected: string | null;
  onSelect: (hash: string) => void;
  onContextMenu: (x: number, y: number, commit: Commit) => void;
}) {
  // Virtualize vertically — only render the visible slice of rows plus a
  // small overscan. The full SVG background (lanes/edges) is rendered as a
  // single absolutely-positioned layer sized to the full list.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const lastRow = Math.min(
    layout.nodes.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 10,
  );
  const visibleNodes = layout.nodes.slice(firstRow, lastRow);

  const totalHeight = layout.nodes.length * ROW_HEIGHT;
  const graphWidth = GRAPH_PADDING_LEFT + layout.laneCount * LANE_WIDTH + 12;

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto">
      <div style={{ height: totalHeight, position: "relative" }}>
        <svg
          width={graphWidth}
          height={totalHeight}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          {layout.edges.map((e, i) => (
            <Edge key={i} edge={e} />
          ))}
          {layout.nodes.map((n) => (
            <circle
              key={n.commit.hash}
              cx={GRAPH_PADDING_LEFT + n.lane * LANE_WIDTH}
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
            style={{ left: graphWidth, top: n.row * ROW_HEIGHT }}
            onClick={() => onSelect(n.commit.hash)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(e.clientX, e.clientY, n.commit);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Edge({ edge }: { edge: ReturnType<typeof layoutCommits>["edges"][number] }) {
  const x1 = GRAPH_PADDING_LEFT + edge.fromLane * LANE_WIDTH;
  const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = GRAPH_PADDING_LEFT + edge.toLane * LANE_WIDTH;
  const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  if (x1 === x2) {
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={edge.color} strokeWidth={2} />;
  }
  // S-curve between lanes when a commit's parent sits on a different lane.
  const d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
  return <path d={d} stroke={edge.color} strokeWidth={2} fill="none" />;
}

function CommitRow({
  node,
  selected,
  style,
  onClick,
  onContextMenu,
}: {
  node: ReturnType<typeof layoutCommits>["nodes"][number];
  selected: boolean;
  style: React.CSSProperties;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const c = node.commit;
  const date = new Date(c.timestamp * 1000);
  return (
    <div
      style={{ ...style, height: ROW_HEIGHT, position: "absolute" }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex w-full cursor-pointer items-center gap-2 pr-3 text-sm ${
        selected ? "bg-neutral-800" : "hover:bg-neutral-900"
      }`}
      title={`${c.hash} · ${c.author} · ${date.toLocaleString()}`}
    >
      {c.refs.map((r) => (
        <RefBadge key={r} ref_={r} />
      ))}
      <span className="min-w-0 flex-1 truncate">{c.subject}</span>
      <span className="shrink-0 text-xs text-neutral-500">{c.author}</span>
      <span className="mono shrink-0 text-xs text-neutral-600">{c.hash.slice(0, 7)}</span>
    </div>
  );
}

function RefBadge({ ref_ }: { ref_: string }) {
  const isTag = ref_.startsWith("tag:");
  const label = isTag ? ref_.slice(4) : ref_;
  const color = isTag ? "bg-amber-900/60 text-amber-200" : "bg-indigo-900/60 text-indigo-200";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${color}`} title={ref_}>
      {label}
    </span>
  );
}
