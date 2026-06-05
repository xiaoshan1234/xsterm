import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: number;
}

export default function Terminal({ sessionId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { writeSession, resizeSession } = useSession();
  const { currentTheme } = useTheme();

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
        foreground: currentTheme.foreground,
        background: currentTheme.background,
        cursor: currentTheme.cursor,
        black: currentTheme.black,
        red: currentTheme.red,
        green: currentTheme.green,
        yellow: currentTheme.yellow,
        blue: currentTheme.blue,
        magenta: currentTheme.magenta,
        cyan: currentTheme.cyan,
        white: currentTheme.white,
        brightBlack: currentTheme.brightBlack,
        brightRed: currentTheme.brightRed,
        brightGreen: currentTheme.brightGreen,
        brightYellow: currentTheme.brightYellow,
        brightBlue: currentTheme.brightBlue,
        brightMagenta: currentTheme.brightMagenta,
        brightCyan: currentTheme.brightCyan,
        brightWhite: currentTheme.brightWhite,
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
  }, [sessionId, handleData, resizeSession, currentTheme]);

  return <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />;
}
