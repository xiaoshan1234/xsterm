import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: number;
}

export default function Terminal({ sessionId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { writeSession, resizeSession } = useSession();

  const handleData = useCallback(
    (data: string) => {
      writeSession(sessionId, data);
    },
    [sessionId, writeSession]
  );

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

    xterm.onData(handleData);

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        resizeSession(sessionId, xterm.rows, xterm.cols);
      }
    };

    window.addEventListener("resize", handleResize);

    let unlisten: (() => void) | null = null;

    listen<[number, number[]]>("session-output", (event) => {
      const [id, data] = event.payload;
      if (id === sessionId) {
        const decoder = new TextDecoder();
        const text = decoder.decode(new Uint8Array(data));
        xterm.write(text);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      unlisten?.();
      xterm.dispose();
    };
  }, [sessionId, handleData, resizeSession]);

  return <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />;
}