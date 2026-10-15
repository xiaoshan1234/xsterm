import { useCallback, useEffect, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";

import { createXterm } from "./xterm";
import { useXtermTheme } from "./useXtermTheme";

export interface UseXtermResult {
  term: XTerm | null;
  mount: (el: HTMLDivElement) => void;
}

export function useXterm(): UseXtermResult {
  const theme = useXtermTheme();
  const [term, setTerm] = useState<XTerm | null>(null);

  useEffect(() => {
    return () => {
      term?.dispose();
    };
  }, [term]);

  const mount = useCallback(
    (el: HTMLDivElement) => {
      if (term) return;
      const created = createXterm({ theme });
      created.open(el);
      setTerm(created);
    },
    [term, theme],
  );

  return { term, mount };
}
