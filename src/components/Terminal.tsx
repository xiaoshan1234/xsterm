import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { uploadImageToSshSession } from "../services/sessionService";
import { ContextMenu, ContextMenuItem } from "./ui/ContextMenu";
import "@xterm/xterm/css/xterm.css";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

interface TerminalProps {
  sessionId: number;
  sessionType?: "local" | "ssh";
  paneId?: string;
}

export default function Terminal({ sessionId, sessionType, paneId }: TerminalProps) {
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

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (sessionType !== "ssh" || paneId) return;

      const target = e.target as Node | null;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) return;

      const collectImages = (items?: DataTransferItemList | null, files?: FileList | null): File[] => {
        const result: File[] = [];
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) result.push(file);
            }
          }
        }
        if (result.length === 0 && files) {
          for (const file of files) {
            if (file.type.startsWith("image/")) {
              result.push(file);
            }
          }
        }
        return result;
      };

      let imageItems = collectImages(e.clipboardData?.items, e.clipboardData?.files);

      if (imageItems.length === 0 && navigator.clipboard && navigator.clipboard.read) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
              if (type.startsWith("image/")) {
                const blob = await clipboardItem.getType(type);
                const extension = type.split("/").pop() || "png";
                imageItems.push(new File([blob], `paste_image.${extension}`, { type }));
              }
            }
          }
        } catch (clipboardErr) {
          console.log("[xsterm] navigator.clipboard.read failed:", clipboardErr);
        }
      }

      if (imageItems.length === 0) return;

      e.preventDefault();
      console.log("[xsterm] Pasting image(s) in SSH session:", imageItems.map((f) => f.name));

      for (const file of imageItems) {
        try {
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          console.log(`[xsterm] Uploading ${file.name} (${bytes.length} bytes)`);
          const remotePath = await uploadImageToSshSession(sessionId, file.name, bytes);
          console.log(`[xsterm] Uploaded to ${remotePath}`);
          writeSessionRef.current(sessionId, remotePath);
        } catch (err) {
          console.error("[xsterm] Failed to upload pasted image:", err);
        }
      }
    },
    [sessionId, sessionType, paneId]
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
    document.addEventListener("paste", handlePaste, true);

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
      document.removeEventListener("paste", handlePaste, true);
      unlisten?.();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      initDoneRef.current = false;
    };
  }, [sessionId, paneId, handleData, handlePaste, currentTheme]);

  return (
    <ContextMenu items={contextMenuItems}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </ContextMenu>
  );
}