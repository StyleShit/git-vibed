import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertDialog } from "@base-ui-components/react/alert-dialog";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Confirmer = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirmer | null>(null);

interface QueuedConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<QueuedConfirm | null>(null);
  const queueRef = useRef<QueuedConfirm[]>([]);

  const ask = useCallback<Confirmer>((opts) => {
    return new Promise<boolean>((resolve) => {
      const entry: QueuedConfirm = { ...opts, resolve };
      setCurrent((existing) => {
        if (existing) {
          queueRef.current.push(entry);
          return existing;
        }
        return entry;
      });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setCurrent((existing) => {
      existing?.resolve(value);
      const next = queueRef.current.shift();
      return next ?? null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {current && (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open) close(false);
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="gui-backdrop-in fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
            <AlertDialog.Popup
              style={{ width: 420 }}
              className="gui-modal-in fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <AlertDialog.Title className="text-sm font-semibold">
                  {current.title}
                </AlertDialog.Title>
              </div>
              <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
                {current.message}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => close(false)}
                  className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                  autoFocus
                >
                  {current.cancelLabel ?? "Cancel"}
                </button>
                <button
                  onClick={() => close(true)}
                  className={`rounded px-3 py-1.5 text-sm text-white transition ${
                    current.danger
                      ? "bg-red-600 hover:bg-red-500"
                      : "bg-indigo-600 hover:bg-indigo-500"
                  }`}
                >
                  {current.confirmLabel ?? "Confirm"}
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirmer {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside ConfirmProvider");
  }
  return ctx;
}
