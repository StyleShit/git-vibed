import { useEffect, useRef, useState } from "react";

// Thin vertical drag handle for resizing horizontally-adjacent panels. The
// caller owns the width state and gets a delta on every pointer-move — we
// don't touch the DOM layout directly so the layout stays React-driven.
export function ResizeHandle({
  onResize,
  side = "right",
}: {
  onResize: (delta: number) => void;
  // "right" — handle sits on the right edge of its parent panel (positive
  //   delta widens the parent). "left" — handle on the left edge (positive
  //   delta widens the parent in the other direction); flips the sign.
  side?: "left" | "right";
}) {
  const dragging = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(side === "right" ? dx : -dx);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onResize, side]);

  return (
    <div
      onPointerDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      className="group/resize relative z-10 w-1 shrink-0 cursor-col-resize bg-neutral-800 transition-colors hover:bg-indigo-500/40 active:bg-indigo-500"
    >
      {/* Wider invisible hit-zone around the visible stripe so users can grab
          it without pixel-perfect aim. */}
      <div className="absolute -inset-x-1 inset-y-0" />
    </div>
  );
}
