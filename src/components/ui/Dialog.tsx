import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";

export function Dialog({
  title,
  children,
  onClose,
  width = 420,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <BaseDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="gui-backdrop-in fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <BaseDialog.Popup
          style={{ width }}
          className="gui-modal-in fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <BaseDialog.Title className="text-sm font-semibold">{title}</BaseDialog.Title>
            <BaseDialog.Close className="text-neutral-400 hover:text-neutral-100">
              ×
            </BaseDialog.Close>
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
