import { useMemo, useState } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { useMutation } from "@tanstack/react-query";
import type { Commit } from "@shared/types";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import {
  checkoutMutation,
  cherryPickMutation,
  resetMutation,
  revertMutation,
} from "../../queries/mutations";
import { useConfirm } from "../ui/Confirm";
import { TagCreateDialog } from "../tags/TagCreateDialog";

export function CommitContextMenu({
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
  const activePath = useActiveTab()?.path ?? "";
  const checkoutMut = useMutation(checkoutMutation(activePath));
  const cherryPickMut = useMutation(cherryPickMutation(activePath));
  const revertMut = useMutation(revertMutation(activePath));
  const resetMut = useMutation(resetMutation(activePath));
  const confirmDialog = useConfirm();
  const [showTag, setShowTag] = useState(false);

  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );

  async function cherryPick() {
    try {
      await cherryPickMut.mutateAsync(commit.hash);
      toast("success", `Cherry-picked ${commit.hash.slice(0, 7)}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function revert() {
    const ok = await confirmDialog({
      title: `Revert ${commit.hash.slice(0, 7)}`,
      message: "This creates a new commit undoing the changes.",
      confirmLabel: "Revert",
    });
    if (!ok) return;
    try {
      await revertMut.mutateAsync(commit.hash);
      toast("success", `Reverted ${commit.hash.slice(0, 7)}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function reset(mode: "soft" | "mixed" | "hard") {
    const ok = await confirmDialog({
      title: `Reset (${mode})`,
      message:
        mode === "hard"
          ? `Reset to ${commit.hash.slice(0, 7)} (hard).\nThis discards all uncommitted changes.`
          : `Reset to ${commit.hash.slice(0, 7)} (${mode}).`,
      confirmLabel: `Reset (${mode})`,
      danger: mode === "hard",
    });
    if (!ok) return;
    try {
      await resetMut.mutateAsync({ target: commit.hash, mode });
      toast("success", `Reset (${mode})`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function checkout() {
    try {
      await checkoutMut.mutateAsync(commit.hash);
      toast("info", `Detached HEAD at ${commit.hash.slice(0, 7)}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Menu.Root
        open={!showTag}
        onOpenChange={(open) => {
          if (!open && !showTag) onClose();
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
            <Menu.Popup className="min-w-[180px] rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl outline-none">
              <Item onClick={checkout}>Checkout this commit</Item>
              <Item onClick={cherryPick}>Cherry-pick</Item>
              <Item onClick={revert}>Revert</Item>
              <Divider />
              <Item onClick={() => setShowTag(true)} closeOnClick={false}>
                Create tag here…
              </Item>
              <Divider />
              <Item onClick={() => reset("soft")}>Reset (soft)</Item>
              <Item onClick={() => reset("mixed")}>Reset (mixed)</Item>
              <Item onClick={() => reset("hard")} danger>
                Reset (hard)
              </Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {showTag && (
        <TagCreateDialog
          initialRef={commit.hash}
          onClose={() => {
            setShowTag(false);
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
  closeOnClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  closeOnClick?: boolean;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      closeOnClick={closeOnClick}
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
