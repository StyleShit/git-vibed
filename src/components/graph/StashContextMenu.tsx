import { useMemo } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { useQuery } from "@tanstack/react-query";
import type { Commit } from "@shared/types";
import { useRepo, useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { gitStashesOptions } from "../../queries/gitApi";
import { useConfirm } from "../ui/Confirm";

// Context menu shown when the user right-clicks a commit that also
// happens to be a stash entry (carries a `stash`/`refs/stash`
// decoration in git log). Stashes aren't really regular commits, so
// revert/cherry-pick/reset don't make sense here — we offer the
// stash-specific verbs instead and fall back to the user's saved
// stash list when we can't resolve the index.
export function StashContextMenu({
  x,
  y,
  commit,
  onClose,
}: {
  x: number;
  y: number;
  commit: Commit;
  onClose: () => void;
}) {
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const activePath = useActiveTab()?.path;
  const stashes = useQuery(gitStashesOptions(activePath)).data ?? [];
  const confirmDialog = useConfirm();

  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );

  // `refs/stash` only decorates stash@{0}, so the graph decoration alone
  // isn't enough when the user has several stashes stacked — matching on
  // the commit SHA resolves the right index regardless of depth.
  const stashEntry =
    stashes.find((s) => s.hash === commit.hash) ??
    stashes.find((s) => s.index === 0) ??
    null;

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast("success", label);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function apply() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      return;
    }
    await run("Applied stash", () =>
      unwrap(window.gitApi.stashApply(stashEntry.index)),
    );
  }

  async function pop() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      return;
    }
    if (stashEntry.index === 0) {
      await run("Popped stash", () => unwrap(window.gitApi.stashPop()));
    } else {
      await run("Popped stash", async () => {
        await unwrap(window.gitApi.stashApply(stashEntry.index));
        await unwrap(window.gitApi.stashDrop(stashEntry.index));
      });
    }
  }

  async function drop() {
    if (!stashEntry) {
      toast("error", "No matching stash entry");
      return;
    }
    const ok = await confirmDialog({
      title: "Drop stash",
      message: `Drop ${stashEntry.ref}?\nThis can't be undone.`,
      confirmLabel: "Drop",
      danger: true,
    });
    if (!ok) return;
    await run("Dropped stash", () =>
      unwrap(window.gitApi.stashDrop(stashEntry.index)),
    );
  }

  function copyHash() {
    void navigator.clipboard.writeText(commit.hash);
    toast("success", "Copied hash");
  }

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
          <Menu.Popup className="min-w-[200px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl outline-none">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
              stash · {commit.hash.slice(0, 7)}
            </div>
            <Item onClick={apply}>Apply</Item>
            <Item onClick={pop}>Pop</Item>
            <Item onClick={drop} danger>
              Drop…
            </Item>
            <Divider />
            <Item onClick={copyHash}>Copy hash</Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
    <Menu.Item
      onClick={onClick}
      className={`block w-full cursor-default px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-neutral-800 ${
        danger ? "text-red-400" : "text-neutral-200"
      }`}
    >
      {children}
    </Menu.Item>
  );
}

function Divider() {
  return <div className="my-1 border-t border-neutral-800" />;
}
