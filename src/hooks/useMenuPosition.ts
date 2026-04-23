import { useLayoutEffect, useRef, useState, type RefObject } from "react";

// Clamp a raw (x, y) mouse origin so the rendered menu always fits
// inside the viewport. Without it, right-clicking near the right or
// bottom edge opens a menu that runs off the window. Runs in a layout
// effect so the corrected position lands in the same paint frame as
// the initial render — no visible jump from cut-off to clamped.
//
// Attach the returned ref to the menu's outermost positioned element.
// The hook measures that element's bounding box after mount and shifts
// it inward (while keeping at least `margin` px of breathing room from
// each edge).
export function useMenuPosition(
  x: number,
  y: number,
): {
  ref: RefObject<HTMLDivElement | null>;
  pos: { left: number; top: number };
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [x, y]);
  return { ref, pos };
}
