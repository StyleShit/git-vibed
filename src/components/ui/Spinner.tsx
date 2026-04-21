// Simple indeterminate spinner. CSS-only (no external icon library) so it
// can be inlined anywhere an operation is in progress.
export function Spinner({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-neutral-600 border-t-indigo-400 ${className}`}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
