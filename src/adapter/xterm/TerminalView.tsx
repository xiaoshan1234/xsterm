import { useEffect, type Ref } from "react";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useXterm } from "./useXterm";

interface TerminalViewProps {
  onTermReady?: (term: Terminal) => void;
  containerRef?: Ref<HTMLDivElement>;
}

export default function TerminalView({
  onTermReady,
  containerRef: externalRef,
}: TerminalViewProps) {
  const { term, containerRef } = useXterm();

  useEffect(() => {
    if (term) onTermReady?.(term);
  }, [term, onTermReady]);

  const setRef = (el: HTMLDivElement | null) => {
    // useXterm 内部持有 containerRef,我们把 DOM 塞进去
    (containerRef as { current: HTMLDivElement | null }).current = el;
    if (externalRef) {
      if (typeof externalRef === "function") {
        externalRef(el);
      } else {
        externalRef.current = el;
      }
    }
  };

  return <div ref={setRef} style={{ width: "100%", height: "100%" }} />;
}
