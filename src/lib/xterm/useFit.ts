import { useEffect } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export function useFit(term: Terminal | null, fitAddon: FitAddon | null): void {
  useEffect(() => {
    if (!term || !fitAddon) return;
    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // container detached or zero-sized
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [term, fitAddon]);
}
