import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { ContextMenu, ContextMenuItem } from "./ui/ContextMenu";
import "@xterm/xterm/css/xterm.css";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

interface TerminalProps {
  sessionId: number;
  paneId?: string;
}

export default function Terminal({ sessionId, paneId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initDoneRef = useRef(false);
  const { writeSession, resizeSession, sendKeysToTmuxPane, resizeTmuxPane, captureTmuxPane, splitTmuxPane } = useSession();
  const { currentTheme } = useTheme();

  const writeSessionRef = useRef(writeSession);
  const resizeSessionRef = useRef(resizeSession);
  const sendKeysToTmuxPaneRef = useRef(sendKeysToTmuxPane);
  const resizeTmuxPaneRef = useRef(resizeTmuxPane);
  const captureTmuxPaneRef = useRef(captureTmuxPane);

  useEffect(() => {
    writeSessionRef.current = writeSession;
    resizeSessionRef.current = resizeSession;
    sendKeysToTmuxPaneRef.current = sendKeysToTmuxPane;
    resizeTmuxPaneRef.current = resizeTmuxPane;
    captureTmuxPaneRef.current = captureTmuxPane;
  }, [writeSession, resizeSession, sendKeysToTmuxPane, resizeTmuxPane, captureTmuxPane]);

  const handleData = useCallback(
    (data: string) => {
      if (paneId) {
        sendKeysToTmuxPaneRef.current(sessionId, paneId, data);
      } else {
        writeSessionRef.current(sessionId, data);
      }
    },
    [sessionId, paneId]
  );

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: "全选 (Select All)",
      onClick: () => {
        xtermRef.current?.selectAll();
      },
    },
    {
      label: "复制 (Copy)",
      onClick: async () => {
        const selection = xtermRef.current?.getSelection();
        if (selection) {
          await navigator.clipboard.writeText(selection).catch(() => {});
        }
      },
    },
  ];

  if (paneId) {
    contextMenuItems.push({
      label: "水平拆分 (Split H)",
      onClick: () => {
        splitTmuxPane(sessionId, paneId, "h");
      },
    });
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    xterm.open(container);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    xterm.onData(handleData);

    const fitAndResize = () => {
      if (fitAddonRef.current && container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddonRef.current.fit();
        if (paneId) {
          resizeTmuxPaneRef.current(sessionId, paneId, xterm.rows, xterm.cols);
        } else {
          resizeSessionRef.current(sessionId, xterm.rows, xterm.cols);
        }
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (initDoneRef.current) {
        fitAndResize();
      }
    });
    resizeObserver.observe(container);

    requestAnimationFrame(() => {
      fitAndResize();
      initDoneRef.current = true;
      setTimeout(fitAndResize, 300);
      setTimeout(fitAndResize, 800);
    });

    let unlisten: (() => void) | null = null;

    if (paneId) {
      listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", (event) => {
        const [id, output] = event.payload;
        if (id === sessionId && output.paneId === paneId) {
          xterm.write(decodeOutput(output.data));
        }
      }).then((fn) => {
        unlisten = fn;
        captureTmuxPaneRef.current(sessionId, paneId).catch(() => {
          // Capture failures are surfaced via tmux-control-event CommandError.
        });
      });
    } else {
      listen<[number, number[]]>("session-output", (event) => {
        const [id, data] = event.payload;
        if (id === sessionId) {
          const text = decodeOutput(data);
          xterm.write(text);
        }
      }).then((fn) => {
        unlisten = fn;
      });
    }

    return () => {
      resizeObserver.disconnect();
      unlisten?.();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      initDoneRef.current = false;
    };
  }, [sessionId, paneId, handleData, currentTheme]);

  return (
    <ContextMenu items={contextMenuItems}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </ContextMenu>
  );
}