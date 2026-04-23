import { Toast } from "@base-ui-components/react/toast";

export function Toasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Viewport className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          toast={t}
          className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 ${
            t.type === "error"
              ? "border-red-900 bg-red-950 text-red-200"
              : t.type === "success"
                ? "border-emerald-900 bg-emerald-950 text-emerald-200"
                : "border-neutral-700 bg-neutral-900 text-neutral-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <Toast.Title className="whitespace-pre-wrap" />
            <Toast.Close
              className="text-neutral-500 hover:text-neutral-100"
              aria-label="dismiss"
            >
              ×
            </Toast.Close>
          </div>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}
