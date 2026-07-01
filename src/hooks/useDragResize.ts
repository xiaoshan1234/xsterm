import { useCallback, useEffect, useRef } from "react";

export type DragResizeDirection = "horizontal" | "vertical";

export interface DragResizeStartPayload {
  clientX: number;
  clientY: number;
  initialValue: number;
}

export interface DragResizeDeltaPayload {
  clientX: number;
  clientY: number;
  delta: number;
  initialValue: number;
}

export interface UseDragResizeOptions {
  direction: DragResizeDirection;
  onStart?: (payload: DragResizeStartPayload) => void;
  onDelta?: (payload: DragResizeDeltaPayload) => void;
  onEnd?: () => void;
}

export function useDragResize({ direction, onStart, onDelta, onEnd }: UseDragResizeOptions) {
  const stateRef = useRef<{
    initialValue: number;
    startX: number;
    startY: number;
  } | null>(null);

  const optionsRef = useRef({ direction, onStart, onDelta, onEnd });
  optionsRef.current = { direction, onStart, onDelta, onEnd };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const state = stateRef.current;
    if (!state) return;

    const { clientX, clientY } = e;
    const delta =
      optionsRef.current.direction === "horizontal"
        ? clientX - state.startX
        : clientY - state.startY;

    optionsRef.current.onDelta?.({
      clientX,
      clientY,
      delta,
      initialValue: state.initialValue,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    stateRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    optionsRef.current.onEnd?.();
  }, [handleMouseMove]);

  const start = useCallback(
    (initialValue: number, e: React.MouseEvent) => {
      e.preventDefault();

      const { clientX, clientY } = e;
      stateRef.current = { initialValue, startX: clientX, startY: clientY };

      document.body.style.cursor =
        optionsRef.current.direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      optionsRef.current.onStart?.({ clientX, clientY, initialValue });

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [handleMouseMove, handleMouseUp]
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return { start };
}
