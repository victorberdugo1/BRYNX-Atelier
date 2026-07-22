import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal"; // vertical = drag left/right, resizes width
  onResize: (delta: number) => void;
  className?: string;
}

export function ResizeHandle({ orientation, onResize, className }: ResizeHandleProps) {
  const lastPos = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const pos = orientation === "vertical" ? ev.clientX : ev.clientY;
        const delta = pos - lastPos.current;
        lastPos.current = pos;
        onResize(delta);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [orientation, onResize]
  );

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "shrink-0 bg-transparent transition-colors hover:bg-accent/40 active:bg-accent/60",
        orientation === "vertical" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className
      )}
    />
  );
}
