import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Dialog } from "./Dialog";

// Replacement for the browser `confirm()` dialog — matches the app theme,
// supports a danger style for destructive actions, and runs through the
// same React reconciler so stacking/rendering behaves predictably
// (unlike the synchronous native prompt, which blocks the event loop
// and occasionally leaves hover state stuck on the row that opened it).

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
        <Dialog title={current.title} onClose={() => close(false)} width={420}>
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
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

// Hook used by components that want to pop a confirm without passing the
// provider context explicitly. Returns a stable async function so it
// can be called inside effects or event handlers without re-renders.
export function useConfirm(): Confirmer {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside ConfirmProvider");
  }
  return ctx;
}
