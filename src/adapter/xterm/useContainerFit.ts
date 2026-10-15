import { useEffect, type RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export function useContainerFit(
  term: Terminal | null,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!term) return;
    const container = containerRef.current;
    if (!container) return;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const tryFit = () => {
      try {
        fitAddon.fit();
      } catch {
        // container not yet sized
      }
    };
    tryFit();
    const observer = new ResizeObserver(tryFit);
    observer.observe(container);
    window.addEventListener("resize", tryFit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", tryFit);
    };
  }, [term, containerRef]);
}
