import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useSession } from "../contexts/SessionContext";

export function useTerminalResize(
  containerRef: RefObject<HTMLDivElement | null>,
  termRef: RefObject<XTerm | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  sessionId: number,
  _sessionType?: "local" | "ssh",
  paneId?: string
): void {
  const { resizeSession, resizeTmuxPane } = useSession();
  const resizeSessionRef = useRef(resizeSession);
  const resizeTmuxPaneRef = useRef(resizeTmuxPane);

  useEffect(() => {
    resizeSessionRef.current = resizeSession;
    resizeTmuxPaneRef.current = resizeTmuxPane;
  }, [resizeSession, resizeTmuxPane]);

  useEffect(() => {
    const container = containerRef.current;
    const xterm = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !xterm || !fitAddon) return;

    let initDone = false;
    let resizeTimer: number | null = null;
    const timeoutIds: number[] = [];

    const fitAndResize = () => {
      if (fitAddonRef.current && container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddonRef.current.fit();
        if (paneId) {
          resizeTmuxPaneRef.current(sessionId, paneId, xterm.rows, xterm.cols);
        } else {
          resizeSessionRef.current(sessionId, xterm.rows, xterm.cols);
        }
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
  }, [containerRef, termRef, fitAddonRef, sessionId, paneId]);
}
