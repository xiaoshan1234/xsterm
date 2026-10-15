import { useCallback, useEffect, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";

import { createXterm } from "./xterm";
import { useXtermTheme } from "./useXtermTheme";

export interface UseXtermResult {
  term: XTerm | null;
  fitAddon: FitAddon | null;
  mount: (el: HTMLDivElement) => void;
}

export function useXterm(): UseXtermResult {
  const theme = useXtermTheme();
  const [term, setTerm] = useState<XTerm | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);

  useEffect(() => {
    return () => {
      term?.dispose();
    };
  }, [term]);

  const mount = useCallback(
    (el: HTMLDivElement) => {
      if (term) return;
      const created = createXterm({ theme });
      created.term.open(el);
      try {
        created.fitAddon.fit();
      } catch {
        // container not yet sized
      }
      setTerm(created.term);
      setFitAddon(created.fitAddon);
    },
    [term, theme],
  );

  return { term, fitAddon, mount };
}
