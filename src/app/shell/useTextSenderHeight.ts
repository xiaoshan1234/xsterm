import { useCallback, useEffect, useRef, useState } from "react";
import { getJsonStore } from "../../infra";
import { useDragResize } from "../../shared/hooks/useDragResize";

export const DEFAULT_TEXT_SENDER_HEIGHT = 400;
export const MIN_TEXT_SENDER_HEIGHT = 180;
export const MAX_TEXT_SENDER_HEIGHT = 720;

const UI_SHELL_STORE_FILE = "ui-shell.json";
const TEXT_SENDER_HEIGHT_KEY = "textSenderHeight";
const SAVE_DELAY_MS = 150;

export function clampTextSenderHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_TEXT_SENDER_HEIGHT;
  return Math.min(MAX_TEXT_SENDER_HEIGHT, Math.max(MIN_TEXT_SENDER_HEIGHT, Math.round(height)));
}

export function useTextSenderHeight() {
  const [height, setHeight] = useState(DEFAULT_TEXT_SENDER_HEIGHT);
  const [hasLoaded, setHasLoaded] = useState(false);
  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    let cancelled = false;

    getJsonStore(UI_SHELL_STORE_FILE)
      .get<number>(TEXT_SENDER_HEIGHT_KEY)
      .then((savedHeight) => {
        if (!cancelled && savedHeight !== undefined) {
          setHeight(clampTextSenderHeight(savedHeight));
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
      getJsonStore(UI_SHELL_STORE_FILE)
        .set(TEXT_SENDER_HEIGHT_KEY, height)
        .catch(() => {
          // Persistence is best-effort; dragging must remain responsive.
        });
    }, SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [hasLoaded, height]);

  const { start } = useDragResize({
    direction: "vertical",
    onDelta: ({ initialValue, delta }) => {
      setHeight(clampTextSenderHeight(initialValue - delta));
    },
  });

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      start(heightRef.current, event);
    },
    [start],
  );

  const nudgeHeight = useCallback((delta: number) => {
    setHeight((currentHeight) => clampTextSenderHeight(currentHeight + delta));
  }, []);

  return { height, startResize, nudgeHeight };
}
