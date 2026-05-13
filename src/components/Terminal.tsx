import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  hasSidebarMenu: boolean;
}

export default function Terminal({ hasSidebarMenu }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const xterm = new XTerm({
      fontSize: 14,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      cursorBlink: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        black: "#1e1e1e",
        brightBlack: "#3a3a3a",
        red: "#ce9178",
        brightRed: "#f14c4c",
        green: "#6a9955",
        brightGreen: "#4ec9b0",
        yellow: "#dcdcaa",
        brightYellow: "#d7ba7d",
        blue: "#569cd6",
        brightBlue: "#9cdcfe",
        magenta: "#c586c0",
        brightMagenta: "#c586c0",
        cyan: "#4fc1ff",
        brightCyan: "#2bc4e2",
        white: "#d4d4d4",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const init = async () => {
      try {
        await invoke("spawn_terminal", {
          rows: xterm.rows,
          cols: xterm.cols,
        });
      } catch (e) {
        xterm.writeln(`Failed to spawn terminal: ${e}`);
      }
    };

    init();

    const unlisten = listen<number[]>("terminal-data", (event) => {
      const decoder = new TextDecoder();
      const text = decoder.decode(new Uint8Array(event.payload));
      xterm.write(text);
    });

    xterm.onData((data) => {
      const arr = Array.from(data).map((c) => c.charCodeAt(0));
      invoke("write_terminal", { data: arr });
    });

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      unlisten.then((fn) => fn());
      xterm.dispose();
    };
  }, []);

  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 100);
    }
  }, [hasSidebarMenu]);

  return <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />;
}