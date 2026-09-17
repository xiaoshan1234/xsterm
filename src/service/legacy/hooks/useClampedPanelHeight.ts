import { type RefObject, useCallback, useEffect, useState } from "react";

interface UseClampedPanelHeightArgs {
  containerRef: RefObject<HTMLElement | null>;
  initial?: number;
  min?: number;
}

interface UseClampedPanelHeightResult {
  height: number;
  maxHeight: number;
  onHeightChange: (newHeight: number) => void;
}

/**
 * Tracks a drag-resizable panel's height, clamped between `min` and the
 * container's clientHeight (which is kept in sync via ResizeObserver).
 */
export function useClampedPanelHeight({
  containerRef,
  initial = 160,
  min = 120,
}: UseClampedPanelHeightArgs): UseClampedPanelHeightResult {
  const [height, setHeight] = useState(initial);
  const [maxHeight, setMaxHeight] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateMax = () => {
      setMaxHeight(el.clientHeight);
    };

    updateMax();

    const observer = new ResizeObserver(updateMax);
    observer.observe(el);

    return () => observer.disconnect();
  }, [containerRef]);

  const onHeightChange = useCallback(
    (newHeight: number) => {
      setHeight(Math.min(Math.max(newHeight, min), Math.max(maxHeight, min)));
    },
    [maxHeight, min],
  );

  return { height, maxHeight, onHeightChange };
}
