import { useEffect, useRef, type Ref } from "react";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useFit } from "./useFit";
import { useXterm } from "./useXterm";

export interface TerminalViewProps {
  onTermReady?: (term: Terminal) => void;
  containerRef?: Ref<HTMLDivElement>;
}

export default function TerminalView({ onTermReady, containerRef }: TerminalViewProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  const setContainerRef = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (typeof containerRef === "function") containerRef(el);
    else if (containerRef) (containerRef as { current: HTMLDivElement | null }).current = el;
  };

  const { term, fitAddon, mount } = useXterm();

  useEffect(() => {
    if (term) onTermReady?.(term);
  }, [term, onTermReady]);

  useEffect(() => {
    const el = innerRef.current;
    if (el && !term) mount(el);
  }, [term, mount]);

  useFit(term, fitAddon);

  return <div ref={setContainerRef} style={{ width: "100%", height: "100%" }} />;
}
