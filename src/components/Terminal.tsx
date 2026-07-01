import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { uploadImageToSshSession } from "../services/sessionService";
import { getClipboardImages } from "../utils/clipboard";
import { useXterm } from "../hooks/useXterm";
import { useTauriTerminalOutput } from "../hooks/useTauriTerminalOutput";
import { useTerminalResize } from "../hooks/useTerminalResize";
import "@xterm/xterm/css/xterm.css";

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

const XTERM_OPTIONS = {
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorBlink: true,
  screenReaderMode: false,
};

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  { sessionId, sessionType, paneId, isActive = true, onFocus },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { currentTheme } = useTheme();
  const { termRef, fitAddonRef } = useXterm(containerRef, currentTheme, XTERM_OPTIONS);

  const { writeSession, sendKeysToTmuxPane, getEffectiveLocalEcho } = useSession();
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
  const sendKeysToTmuxPaneRef = useRef(sendKeysToTmuxPane);

  useEffect(() => {
    writeSessionRef.current = writeSession;
    sendKeysToTmuxPaneRef.current = sendKeysToTmuxPane;
  }, [writeSession, sendKeysToTmuxPane]);

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
    const xterm = termRef.current;
    if (!xterm) return;

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

    const dataDisposer = xterm.onData((data) => {
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

    return () => {
      dataDisposer.dispose();
    };
  }, [sessionId, paneId]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste, true);
    return () => {
      document.removeEventListener("paste", handlePaste, true);
    };
  }, [handlePaste]);

  useTauriTerminalOutput(termRef, sessionId, sessionType, paneId);
  useTerminalResize(containerRef, termRef, fitAddonRef, sessionId, sessionType, paneId);

  useImperativeHandle(
    ref,
    () => ({
      selectAll: () => {
        termRef.current?.selectAll();
      },
      copySelection: async () => {
        const selection = termRef.current?.getSelection();
        if (selection) {
          await navigator.clipboard.writeText(selection).catch(() => {});
        }
      },
    }),
    []
  );

  useEffect(() => {
    const xterm = termRef.current;
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
