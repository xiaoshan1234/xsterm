import { useEffect, useRef, useState, type RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";

import { createXterm } from "./xterm";
import { useXtermTheme } from "./useXtermTheme";

export interface UseXtermResult {
  term: XTerm | null;
  containerRef: RefObject<HTMLDivElement | null>;
}

// ref-based pattern(对照 ref/xsterm/src/service/hooks/terminal/useXterm.ts):
// 父组件传 ref 进来,useEffect 读 ref.current 创建 xterm。commit 阶段 ref 已被赋值,
// useEffect 跑时 ref.current 一定有值,不会"创建了但没 open"。
export function useXterm(): UseXtermResult {
  const theme = useXtermTheme();
  const [term, setTerm] = useState<XTerm | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const created = createXterm({ theme });
    created.open(el);
    console.debug(`[xterm] created, cols=${created.cols} rows=${created.rows}`);
    setTerm(created);
    return () => {
      created.dispose();
      setTerm(null);
    };
  }, [containerRef, theme]);

  return { term, containerRef };
}
