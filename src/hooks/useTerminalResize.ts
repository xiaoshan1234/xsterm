import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useSession } from "../contexts/SessionContext";

export function useTerminalResize(
  containerRef: RefObject<HTMLDivElement | null>,
  termRef: RefObject<XTerm | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  sessionId: number,
  isWindowActive: boolean = true
): void {
  const { resizeSession } = useSession();
  const resizeSessionRef = useRef(resizeSession);

  useEffect(() => {
    resizeSessionRef.current = resizeSession;
  }, [resizeSession]);

  // Use ResizeObserver to listen for container size changes, trigger fitAddon.fit() to make xterm adapt to the new size,
  // and notify Tauri backend of rows/cols to resize the PTY.
  // Debounce logic: delays fitAndResize by 150ms after container changes to avoid frequent resizes.
  // On init, multiple requestAnimationFrame/setTimeout calls ensure proper size application (at 0/300/800ms delays).
  // On cleanup, disconnects ResizeObserver and cancels all pending raf/timeout.
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
}
