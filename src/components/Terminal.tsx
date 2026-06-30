import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { uploadImageToSshSession } from "../services/sessionService";
import { getClipboardImages } from "../utils/clipboard";
import "@xterm/xterm/css/xterm.css";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

interface PendingWrite {
  text: string;
  resolve: () => void;
}

interface TerminalProps {
  sessionId: number;
  sessionType?: "local" | "ssh";
  paneId?: string;
  isActive?: boolean;
  onFocus?: () => void;
}

export interface TerminalRef {
  selectAll: () => void;
  copySelection: () => Promise<void>;
}

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  { sessionId, sessionType, paneId, isActive = true, onFocus },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initDoneRef = useRef(false);
  const { writeSession, resizeSession, sendKeysToTmuxPane, resizeTmuxPane, captureTmuxPane, getEffectiveLocalEcho } = useSession();
  const { currentTheme } = useTheme();
  const localEchoEnabled = getEffectiveLocalEcho(sessionId);

  const localEchoEnabledRef = useRef(localEchoEnabled);
  const lastDataRef = useRef<{ text: string; time: number } | null>(null);

  const isFocusedRef = useRef(isActive);

  useEffect(() => {
    isFocusedRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    localEchoEnabledRef.current = localEchoEnabled;
  }, [localEchoEnabled]);

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

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (sessionType !== "ssh" || paneId) return;

      const target = e.target as Node | null;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) return;

      const imageItems = await getClipboardImages(e);
      if (imageItems.length === 0) return;

      e.preventDefault();

      for (const file of imageItems) {
        try {
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          const remotePath = await uploadImageToSshSession(sessionId, file.name, bytes);
          writeSessionRef.current(sessionId, remotePath);
        } catch (err) {
          console.error("[xsterm] Failed to upload pasted image:", err);
        }
      }
    },
    [sessionId, sessionType, paneId]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new XTerm({
      fontSize: 14,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      cursorBlink: true,
      screenReaderMode: false,
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

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && (event.key === "n" || event.key === "N") && event.shiftKey) {
        return false;
      }
      if (event.ctrlKey && event.key === "Tab") {
        return false;
      }
      if (event.ctrlKey && (event.key === "w" || event.key === "W")) {
        return false;
      }
      if (event.ctrlKey && (event.key === "l" || event.key === "L")) {
        return false;
      }
      if (event.ctrlKey && event.key === ",") {
        return false;
      }
      return true;
    });

    xterm.onData((data) => {
      if (!isFocusedRef.current) return;

      const now = Date.now();
      const last = lastDataRef.current;
      if (last && last.text === data && now - last.time < 30) {
        return;
      }
      lastDataRef.current = { text: data, time: now };

      if (localEchoEnabledRef.current) {
        xterm.write(data);
      }
      if (paneId) {
        sendKeysToTmuxPaneRef.current(sessionId, paneId, data);
      } else {
        writeSessionRef.current(sessionId, data);
      }
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    xterm.open(container);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

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
    let listenerActive = true;
    let rafId: number | null = null;
    let writeQueue: PendingWrite[] = [];

    const flushWrites = () => {
      rafId = null;
      if (writeQueue.length === 0 || !xtermRef.current) return;
      const pending = writeQueue;
      writeQueue = [];
      const text = pending.map((w) => w.text).join("");
      xtermRef.current.write(text, () => {
        for (const w of pending) {
          w.resolve();
        }
      });
    };

    const queueWrite = (text: string): Promise<void> => {
      return new Promise((resolve) => {
        writeQueue.push({ text, resolve });
        if (rafId === null) {
          rafId = requestAnimationFrame(flushWrites);
        }
      });
    };

    if (paneId) {
      listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", (event) => {
        const [id, output] = event.payload;
        if (id === sessionId && output.paneId === paneId) {
          queueWrite(decodeOutput(output.data));
        }
      }).then((fn) => {
        if (listenerActive) {
          unlisten = fn;
          captureTmuxPaneRef.current(sessionId, paneId).catch(() => {});
        } else {
          fn();
        }
      });
    } else {
      listen<[number, number[]]>("session-output", (event) => {
        const [id, data] = event.payload;
        if (id === sessionId) {
          queueWrite(decodeOutput(data));
        }
      }).then((fn) => {
        if (listenerActive) {
          unlisten = fn;
        } else {
          fn();
        }
      });
    }

    return () => {
      listenerActive = false;
      resizeObserver.disconnect();
      document.removeEventListener("paste", handlePaste, true);
      unlisten?.();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        xterm.write(writeQueue.map((w) => w.text).join(""));
      }
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      initDoneRef.current = false;
    };
  }, [sessionId, paneId, handlePaste, currentTheme]);

  useImperativeHandle(
    ref,
    () => ({
      selectAll: () => {
        xtermRef.current?.selectAll();
      },
      copySelection: async () => {
        const selection = xtermRef.current?.getSelection();
        if (selection) {
          await navigator.clipboard.writeText(selection).catch(() => {});
        }
      },
    }),
    []
  );

  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    if (isActive) {
      xterm.focus();
    } else {
      xterm.blur();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
      onMouseDown={onFocus}
    />
  );
});

export default Terminal;
