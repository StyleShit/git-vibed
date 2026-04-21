import type { Result } from "@shared/types";

// Unwrap Result<T> from preload. Callers get a thrown error or the data —
// the raw Result wrapper only exists so IPC errors don't reach devtools as
// unhandled rejections.
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// Safer variant that returns data-or-null without throwing — useful for
// fire-and-forget reads (e.g. optional gh commands on hosts without gh).
export async function maybe<T>(p: Promise<Result<T>>): Promise<T | null> {
  const r = await p;
  return r.ok ? r.data : null;
}
