import { useEffect, useRef, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";
import { type FitAddon } from "@xterm/addon-fit";
import { useSession } from "../contexts/SessionContext";
import { type SessionDisplayConfig } from "../types/session";

export function useTerminalResize(
  containerRef: RefObject<HTMLDivElement | null>,
  termRef: RefObject<XTerm | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  sessionId: number,
  displayConfig?: SessionDisplayConfig,
  isWindowActive: boolean = true,
): void {
  const { resizeSession } = useSession();
  const resizeSessionRef = useRef(resizeSession);

  useEffect(() => {
    resizeSessionRef.current = resizeSession;
  }, [resizeSession]);

  // Mirror displayConfig into a ref so the debounced ResizeObserver closure
  // always reads the latest sizing mode without re-subscribing to the observer.
  const displayConfigRef = useRef<SessionDisplayConfig | undefined>(displayConfig);
  useEffect(() => {
    displayConfigRef.current = displayConfig;
  }, [displayConfig]);

  // Use ResizeObserver to listen for container size changes, trigger fitAddon.fit() to make xterm adapt to the new size,
  // and notify Tauri backend of rows/cols to resize the PTY.
  // Debounce logic: delays fitAndResize by 150ms after container changes to avoid frequent resizes.
  // On init, multiple requestAnimationFrame/setTimeout calls ensure proper size application (at 0/300/800ms delays).
  // On cleanup, disconnects ResizeObserver and cancels all pending raf/timeout.
  // When sizingMode is "fixed", container resizes are ignored (terminal stays at cols × rows).
  useEffect(() => {
    const container = containerRef.current;
    const xterm = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !xterm || !fitAddon) return;

    let initDone = false;
    let resizeTimer: number | null = null;
    const timeoutIds: number[] = [];

    const fitAndResize = () => {
      if (!isWindowActive) return;
      if (displayConfigRef.current?.sizingMode === "fixed") return;
      if (fitAddonRef.current && container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddonRef.current.fit();
        resizeSessionRef.current(sessionId, xterm.rows, xterm.cols);
      }
    };

    const debouncedFitAndResize = () => {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (initDone) {
          fitAndResize();
        }
      }, 150);
    };

    const resizeObserver = new ResizeObserver(() => {
      debouncedFitAndResize();
    });
    resizeObserver.observe(container);

    const initRafId = requestAnimationFrame(() => {
      fitAndResize();
      initDone = true;
      timeoutIds.push(window.setTimeout(fitAndResize, 300));
      timeoutIds.push(window.setTimeout(fitAndResize, 800));
    });

    return () => {
      resizeObserver.disconnect();
      if (initRafId !== null) {
        cancelAnimationFrame(initRafId);
      }
      timeoutIds.forEach((id) => clearTimeout(id));
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
    };
  }, [containerRef, termRef, fitAddonRef, sessionId, isWindowActive]);

  // Runtime apply: when the user changes sizingMode, cols, or rows via the
  // EditSessionDialog, push the new size to the live xterm + PTY without
  // requiring a session restart.
  // - "fixed": lock xterm (and PTY) to displayConfig.cols × displayConfig.rows.
  // - "auto": re-fit to container and resync PTY from current xterm dims.
  useEffect(() => {
    const xterm = termRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;
    if (!xterm || !fitAddon || !container) return;
    if (!isWindowActive) return;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

    const sizingMode = displayConfig?.sizingMode ?? "auto";

    if (sizingMode === "fixed") {
      const targetCols = displayConfig?.cols ?? xterm.cols ?? 80;
      const targetRows = displayConfig?.rows ?? xterm.rows ?? 24;
      if (xterm.cols !== targetCols || xterm.rows !== targetRows) {
        xterm.resize(targetCols, targetRows);
        resizeSessionRef.current(sessionId, targetRows, targetCols);
      }
    } else {
      fitAddon.fit();
      resizeSessionRef.current(sessionId, xterm.rows, xterm.cols);
    }
  }, [
    displayConfig?.sizingMode,
    displayConfig?.cols,
    displayConfig?.rows,
    isWindowActive,
    sessionId,
    containerRef,
    termRef,
    fitAddonRef,
  ]);
}
