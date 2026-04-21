import { useMemo, useRef, useState } from "react";
import { useActiveTabShallow } from "../../stores/repo";
import { useSettings } from "../../stores/settings";
import { BranchList, type BranchListHandle } from "../branches/BranchList";
import { PRList } from "../github/PRList";
import { RemoteBranchList } from "../branches/RemoteBranchList";
import { StashList } from "../stashes/StashList";
import { TagList } from "../tags/TagList";
import { WorktreeList } from "../worktrees/WorktreeList";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CollapseAllIcon,
  ExpandAllIcon,
  PlusIcon,
  SearchIcon,
} from "../ui/Icons";
import { BranchCreateDialog } from "../branches/BranchCreateDialog";
import { AddRemoteDialog } from "../remotes/AddRemoteDialog";

type SectionId = "local" | "remote" | "stashes" | "worktrees" | "prs" | "tags";

interface SectionDef {
  id: SectionId;
  label: string;
  count: number;
  show: boolean;
  render: (filter: string) => React.ReactNode;
  actions?: React.ReactNode;
}

export function Sidebar() {
  const { localCount, remoteCount, stashCount, tagCount, worktreeCount, prCount, ghAvailable } =
    useActiveTabShallow((t) => ({
      localCount: t?.branches.filter((b) => b.isLocal).length ?? 0,
      remoteCount: t?.branches.filter((b) => b.isRemote).length ?? 0,
      stashCount: t?.stashes.length ?? 0,
      tagCount: t?.tags.length ?? 0,
      worktreeCount: t?.worktrees.length ?? 0,
      prCount: t?.prs.length ?? 0,
      ghAvailable: t?.ghAvailable ?? false,
    }));

  const [filter, setFilter] = useState("");
  // Section collapse state is persisted across launches via the settings
  // store so the user doesn't have to re-collapse Tags (or anything else)
  // every time they open the app.
  const collapsedPersisted = useSettings((s) => s.collapsedSidebarSections);
  const setCollapsedPersisted = useSettings((s) => s.setCollapsedSidebarSections);
  const collapsed = useMemo(
    () => new Set<SectionId>(collapsedPersisted),
    [collapsedPersisted],
  );

  const localRef = useRef<BranchListHandle>(null);
  const remoteRef = useRef<BranchListHandle>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddRemote, setShowAddRemote] = useState(false);

  const sections = useMemo<SectionDef[]>(
    () => [
      {
        id: "local",
        label: "Local",
        count: localCount,
        show: true,
        render: (f) => <BranchList ref={localRef} filter={f} kind="local" />,
        actions: (
          <>
            <HeaderActionButton
              title="Expand all folders"
              onClick={() => localRef.current?.expandAll()}
            >
              <ExpandAllIcon className="size-3.5" />
            </HeaderActionButton>
            <HeaderActionButton
              title="Collapse all folders"
              onClick={() => localRef.current?.collapseAll()}
            >
              <CollapseAllIcon className="size-3.5" />
            </HeaderActionButton>
            <HeaderActionButton
              title="New branch"
              onClick={() => setShowCreate(true)}
            >
              <PlusIcon className="size-3.5" />
            </HeaderActionButton>
          </>
        ),
      },
      {
        id: "remote",
        label: "Remote",
        count: remoteCount,
        show: true,
        render: (f) => <RemoteBranchList ref={remoteRef} filter={f} />,
        actions: (
          <>
            <HeaderActionButton
              title="Expand all folders"
              onClick={() => remoteRef.current?.expandAll()}
            >
              <ExpandAllIcon className="size-3.5" />
            </HeaderActionButton>
            <HeaderActionButton
              title="Collapse all folders"
              onClick={() => remoteRef.current?.collapseAll()}
            >
              <CollapseAllIcon className="size-3.5" />
            </HeaderActionButton>
            <HeaderActionButton
              title="Add remote"
              onClick={() => setShowAddRemote(true)}
            >
              <PlusIcon className="size-3.5" />
            </HeaderActionButton>
          </>
        ),
      },
      {
        id: "worktrees",
        label: "Worktrees",
        count: worktreeCount,
        show: true,
        render: (f) => <WorktreeList filter={f} />,
      },
      {
        id: "stashes",
        label: "Stashes",
        count: stashCount,
        show: true,
        render: (f) => <StashList filter={f} />,
      },
      {
        id: "prs",
        label: "Pull Requests",
        count: prCount,
        show: ghAvailable,
        render: (f) => <PRList filter={f} />,
      },
      {
        id: "tags",
        label: "Tags",
        count: tagCount,
        show: true,
        render: (f) => <TagList filter={f} />,
      },
    ],
    [localCount, remoteCount, stashCount, tagCount, worktreeCount, prCount, ghAvailable],
  );

  function toggle(id: SectionId) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsedPersisted([...next]);
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-neutral-800 bg-neutral-925">
      <SidebarFilter value={filter} onChange={setFilter} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections
          .filter((s) => s.show)
          .map((s) => (
            <Section
              key={s.id}
              def={s}
              expanded={!collapsed.has(s.id)}
              onToggle={() => toggle(s.id)}
              filter={filter}
            />
          ))}
      </div>
      {showCreate && <BranchCreateDialog onClose={() => setShowCreate(false)} />}
      {showAddRemote && <AddRemoteDialog onClose={() => setShowAddRemote(false)} />}
    </aside>
  );
}

function SidebarFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-2">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter (⌘+⌥+F)"
          className="w-full rounded bg-neutral-800 py-1 pl-7 pr-2 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-indigo-500"
        />
      </div>
    </div>
  );
}

function Section({
  def,
  expanded,
  onToggle,
  filter,
}: {
  def: SectionDef;
  expanded: boolean;
  onToggle: () => void;
  filter: string;
}) {
  return (
    <section className="group/section border-b border-neutral-800 last:border-b-0">
      <div
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 text-neutral-500" />
        ) : (
          <ChevronRightIcon className="size-3 text-neutral-500" />
        )}
        <span className="flex-1 text-left">{def.label}</span>
        {def.actions && expanded && (
          <span
            className="hidden items-center gap-0.5 normal-case tracking-normal group-hover/section:flex"
            onClick={(e) => e.stopPropagation()}
          >
            {def.actions}
          </span>
        )}
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-neutral-400">
          {def.count}
        </span>
      </div>
      {expanded && <div className="pb-1">{def.render(filter)}</div>}
    </section>
  );
}

function HeaderActionButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
    >
      {children}
    </button>
  );
}
