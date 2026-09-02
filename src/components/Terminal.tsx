import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { type SessionDisplayConfig } from "../types/session";
import { uploadImageToSshSession } from "../services/sessionService";
import { getClipboardImages } from "../utils/clipboard";
import { useXterm } from "../hooks/useXterm";
import { useTauriTerminalOutput } from "../hooks/useTauriTerminalOutput";
import { useTerminalResize } from "../hooks/useTerminalResize";
import { useLineNumberOverlay } from "../hooks/useLineNumberOverlay";
import { usePasteBatcher } from "../hooks/usePasteBatcher";
import { countLines } from "../utils/textTransform";
import { PasteConfirmDialog } from "./dialogs/PasteConfirmDialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

// Props:
// - sessionId: Tauri session handle; all terminal operations (write, key) are routed to the backend via this ID
// - sessionType: session type, "local" for local shell, "ssh" for remote connection
// - isActive: whether the current pane is active, determines focus/blur
// - onFocus: triggered when clicked, notifies parent to switch active pane
interface TerminalProps {
  sessionId: number;
  sessionType?: "local" | "ssh";
  isActive?: boolean;
  isWindowActive?: boolean;
  isConnected: boolean;
  configId: string;
  displayConfig?: SessionDisplayConfig;
  onFocus?: () => void;
}

export interface TerminalRef {
  selectAll: () => void;
  copySelection: () => Promise<void>;
  clear: () => void;
  pasteFromClipboard: () => Promise<void>;
}

const DEFAULT_XTERM_OPTIONS = {
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorBlink: true,
  screenReaderMode: false,
  scrollback: 20000,
};

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  {
    sessionId,
    sessionType,
    isActive = true,
    isWindowActive = true,
    isConnected,
    configId: _configId,
    displayConfig,
    onFocus,
  },
  ref,
) {
  // containerRef: xterm.js actual DOM mount point; useXterm creates the Terminal instance inside this div
  const containerRef = useRef<HTMLDivElement>(null);
  // hostRef: positioned ancestor the gutter overlay is measured against (see useLineNumberOverlay)
  const hostRef = useRef<HTMLDivElement>(null);
  const lineNumberOverlayRef = useRef<HTMLDivElement>(null);
  const { currentTheme } = useTheme();
  const xtermOptions = { ...DEFAULT_XTERM_OPTIONS, ...displayConfig };
  // useXterm: initializes xterm.js, loads theme and applies xterm options; returns termRef (xterm instance) and fitAddonRef (auto-fit addon)
  const { termRef, fitAddonRef } = useXterm(containerRef, currentTheme, xtermOptions);

  const { writeSession, getEffectiveLocalEcho, reconnectSession } = useSession();
  const localEchoEnabled = getEffectiveLocalEcho(sessionId);

  const localEchoEnabledRef = useRef(localEchoEnabled);
  const isFocusedRef = useRef(isActive);
  const isConnectedRef = useRef(isConnected);
  const isReconnectingRef = useRef(false);
  const reconnectSessionRef = useRef(reconnectSession);

  useEffect(() => {
    isFocusedRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    localEchoEnabledRef.current = localEchoEnabled;
  }, [localEchoEnabled]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    reconnectSessionRef.current = reconnectSession;
  }, [reconnectSession]);

  const writeSessionRef = useRef(writeSession);

  useEffect(() => {
    writeSessionRef.current = writeSession;
  }, [writeSession]);

  // Perf 010: paste chunking + confirmation. The batcher owns rAF pacing so
  // a single paste doesn't hold the SessionManager mutex across one giant
  // write_all; the dialog gives the user a chance to scrub line endings
  // and tabs before any bytes reach the PTY.
  // Bracketed-paste wrap (Perf 011 follow-up): xterm.js tracks DEC mode 2004
  // automatically via `terminal.modes.bracketedPasteMode`; we read it here
  // so vim/fzf/etc. receive the ESC[200~ / ESC[201~ markers when supported.
  const { enqueuePaste } = usePasteBatcher(sessionId);
  const [pendingPasteText, setPendingPasteText] = useState<string | null>(null);

  const readBracketedPasteMode = useCallback((): boolean => {
    return termRef.current?.modes.bracketedPasteMode === true;
  }, []);

  // Threshold for showing the dialog (matches oxideterm):
  // any paste containing a newline that spans more than 1 line OR more than
  // 50 chars is considered risky enough to warrant confirmation. A single-
  // line, short paste (e.g. `ls`, `pwd`, a copied URL) skips the dialog.
  const requestPaste = useCallback(
    (text: string) => {
      if (!isConnectedRef.current) return;
      const hasNewline = text.includes("\n");
      const lineCount = countLines(text).length;
      const isLargePaste = hasNewline && (lineCount > 1 || text.length > 50);
      if (isLargePaste) {
        setPendingPasteText(text);
      } else {
        enqueuePaste(text, readBracketedPasteMode());
      }
    },
    [enqueuePaste, readBracketedPasteMode],
  );

  const handlePasteConfirm = useCallback(
    (transformedText: string) => {
      setPendingPasteText(null);
      enqueuePaste(transformedText, readBracketedPasteMode());
    },
    [enqueuePaste, readBracketedPasteMode],
  );

  const handlePasteCancel = useCallback(() => {
    setPendingPasteText(null);
  }, []);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const target = e.target as Node | null;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) return;

      const text = e.clipboardData?.getData("text") || e.clipboardData?.getData("text/plain");

      if (text) {
        e.preventDefault();
        e.stopPropagation();
        requestPaste(text);
        return;
      }

      if (sessionType !== "ssh") return;

      const imageItems = await getClipboardImages(e);
      if (imageItems.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

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
    [sessionId, sessionType, requestPaste],
  );

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    isReconnectingRef.current = false;
    // When reconnecting, a brand-new PTY/SSH session is created, but the xterm instance still retains
    // the old session's mode state (e.g., mouse tracking mode). Without resetting these internal
    // states, xterm will still generate mouse event escape sequences on mouse movement and send them
    // to the new PTY, which has not enabled the corresponding mode, treating these sequences as
    // regular characters and displaying garbled output. reset() is equivalent to RIS, clearing the
    // screen and resetting all modes.
    xterm.reset();

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      const copyShortcut =
        (event.ctrlKey && event.shiftKey && (event.key === "c" || event.key === "C")) ||
        (event.ctrlKey && event.key === "Insert") ||
        (event.metaKey && (event.key === "c" || event.key === "C"));

      if (copyShortcut) {
        const selection = xterm.getSelection();
        if (selection && selection.length > 0) {
          writeText(selection).catch((err) => {
            console.error("[xsterm] Failed to copy selection via keyboard:", err);
          });
        }
        return false;
      }

      // Only handle shortcuts whose browser default does NOT synthesize a
      // paste event; otherwise let the document handler run so it can read
      // both text and image clipboard data.
      const isTerminalPasteShortcut =
        event.ctrlKey && event.shiftKey && (event.key === "v" || event.key === "V");

      if (isTerminalPasteShortcut && isConnectedRef.current) {
        event.preventDefault();
        readText()
          .then((text) => {
            if (text && isConnectedRef.current) {
              requestPaste(text);
            }
          })
          .catch((err) => {
            console.error("[xsterm] Failed to paste text from clipboard:", err);
          });
        return false;
      }

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

      if (!isConnectedRef.current) {
        if (data === "\r" && !isReconnectingRef.current) {
          isReconnectingRef.current = true;
          reconnectSessionRef.current(sessionId).finally(() => {
            isReconnectingRef.current = false;
          });
        }
        return;
      }

      if (localEchoEnabledRef.current) {
        xterm.write(data);
      }
      // Send the keystroke straight to the PTY. There used to be a
      // requestAnimationFrame batch here (Perf 003) that coalesced
      // multiple keystrokes per frame, but it also added a 1-frame
      // (~16 ms) display delay that users perceived as a character
      // showing up only on the *next* keystroke. With the Rust side
      // already coalescing reads into 64 KiB chunks (Perf 005), the
      // JS-side input batching buys nothing and only hurts latency.
      writeSessionRef.current(sessionId, data);
    });

    const selectionDisposer = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection && selection.length > 0) {
        writeText(selection).catch((err) => {
          console.error("[xsterm] Failed to copy selection on change:", err);
        });
      }
    });

    return () => {
      dataDisposer.dispose();
      selectionDisposer.dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste, true);
    return () => {
      document.removeEventListener("paste", handlePaste, true);
    };
  }, [handlePaste]);

  // useTauriTerminalOutput: subscribes to Tauri backend PTY output stream, writes data to xterm display
  // useTerminalResize: listens for container size changes, calls fitAddon.fit() to make xterm adapt to the new size
  useTauriTerminalOutput(termRef, sessionId);
  useTerminalResize(containerRef, termRef, fitAddonRef, sessionId, displayConfig, isWindowActive);
  useLineNumberOverlay({
    termRef,
    hostRef,
    overlayRef: lineNumberOverlayRef,
    sessionId,
    enabled: displayConfig?.lineNumberEnabled ?? true,
  });

  useImperativeHandle(
    ref,
    () => ({
      selectAll: () => {
        termRef.current?.selectAll();
      },
      copySelection: async () => {
        const selection = termRef.current?.getSelection();
        if (selection) {
          try {
            await writeText(selection);
          } catch (err) {
            console.error("[xsterm] Failed to copy selection to clipboard:", err);
          }
        }
      },
      clear: () => {
        termRef.current?.clear();
      },
      pasteFromClipboard: async () => {
        try {
          const text = await readText();
          if (text && isConnectedRef.current) {
            requestPaste(text);
          }
        } catch (err) {
          console.error("[xsterm] Failed to paste from clipboard:", err);
        }
      },
    }),
    [sessionId, requestPaste],
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
    <div ref={hostRef} className="terminal-host" onMouseDown={onFocus}>
      <div ref={lineNumberOverlayRef} className="terminal-line-number-overlay" aria-hidden="true" />
      <div ref={containerRef} className="terminal-container" />
      <PasteConfirmDialog
        isOpen={pendingPasteText !== null}
        text={pendingPasteText ?? ""}
        onConfirm={handlePasteConfirm}
        onCancel={handlePasteCancel}
      />
    </div>
  );
});

export default Terminal;
