import { useUI } from "../../stores/ui";

export function Toasts() {
  const { toasts, dismissToast } = useUI();
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-md border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-900 bg-red-950 text-red-200"
              : t.kind === "success"
                ? "border-emerald-900 bg-emerald-950 text-emerald-200"
                : "border-neutral-700 bg-neutral-900 text-neutral-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="whitespace-pre-wrap">{t.text}</div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-neutral-500 hover:text-neutral-100"
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
