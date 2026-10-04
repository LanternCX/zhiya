import { useCallback, useEffect, useRef, useState } from "react";
import "./resize-handle.css";

export type ResizeDirection = "horizontal" | "vertical";

export interface ResizeHandleProps {
  direction?: ResizeDirection;
  className?: string;
  onResizeStart?: () => void;
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export default function ResizeHandle({
  direction = "horizontal",
  className = "",
  onResizeStart,
  onResize,
  onResizeEnd,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(0);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      startRef.current = direction === "horizontal" ? event.clientX : event.clientY;
      setDragging(true);
      onResizeStart?.();
    },
    [direction, onResizeStart],
  );

  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      if ("buttons" in event && event.buttons === 0) {
        setDragging(false);
        onResizeEnd?.();
        return;
      }
      const current = direction === "horizontal" ? event.clientX : event.clientY;
      onResize(current - startRef.current);
      startRef.current = current;
    };

    const handlePointerUp = () => {
      setDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragging, direction, onResize, onResizeEnd]);

  return (
    <>
      <div
        className={`resize-handle resize-handle--${direction} ${className}`}
        data-dragging={dragging}
        onPointerDown={handlePointerDown}
        role="separator"
        aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      />
      {dragging && <div className="resize-overlay resize-overlay--active" />}
    </>
  );
}
