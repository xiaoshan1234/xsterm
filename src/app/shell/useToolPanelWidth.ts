import { useCallback, useEffect, useRef, useState } from "react";
import { getJsonStore } from "../../infra";
import { useDragResize } from "../../shared/hooks/useDragResize";

export const DEFAULT_TOOL_PANEL_WIDTH = 200;
export const MIN_TOOL_PANEL_WIDTH = 140;
export const MAX_TOOL_PANEL_WIDTH = 400;

const TOOL_PANEL_STORE_FILE = "ui-shell.json";
const TOOL_PANEL_WIDTH_KEY = "toolPanelWidth";
const SAVE_DELAY_MS = 150;

export function clampToolPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TOOL_PANEL_WIDTH;
  return Math.min(MAX_TOOL_PANEL_WIDTH, Math.max(MIN_TOOL_PANEL_WIDTH, Math.round(width)));
}

export function useToolPanelWidth() {
  const [width, setWidth] = useState(DEFAULT_TOOL_PANEL_WIDTH);
  const [hasLoaded, setHasLoaded] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    let cancelled = false;

    getJsonStore(TOOL_PANEL_STORE_FILE)
      .get<number>(TOOL_PANEL_WIDTH_KEY)
      .then((savedWidth) => {
        if (!cancelled && savedWidth !== undefined) {
          setWidth(clampToolPanelWidth(savedWidth));
        }
      })
      .catch(() => {
        // Static UI preview has no Tauri store; resizing still works for the session.
      })
      .finally(() => {
        if (!cancelled) setHasLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;

    const timeoutId = window.setTimeout(() => {
      getJsonStore(TOOL_PANEL_STORE_FILE)
        .set(TOOL_PANEL_WIDTH_KEY, width)
        .catch(() => {
          // Persistence is best-effort; dragging must remain responsive.
        });
    }, SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [hasLoaded, width]);

  const { start } = useDragResize({
    direction: "horizontal",
    onDelta: ({ initialValue, delta }) => {
      setWidth(clampToolPanelWidth(initialValue + delta));
    },
  });

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      start(widthRef.current, event);
    },
    [start],
  );

  const nudgeWidth = useCallback((delta: number) => {
    setWidth((currentWidth) => clampToolPanelWidth(currentWidth + delta));
  }, []);

  return { width, startResize, nudgeWidth };
}
