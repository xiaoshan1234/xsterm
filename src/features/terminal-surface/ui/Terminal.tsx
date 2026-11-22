import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { TerminalId } from "../../../models";
import { useTheme } from "../../../shared/theme/ThemeContext";
import type { TerminalBookmark, TerminalDisplayConfig } from "../../../features/terminal";
import { frontendLogger as logger } from "../../../infra";
import { useXterm } from "./useXterm";
import { useTauriTerminalOutput } from "./useTauriTerminalOutput";
import { useTerminalResize } from "./useTerminalResize";
import { useTerminalGutter } from "./useTerminalGutter";
import {
  MAX_PROMPT_JUMP_STEPS,
  encodeWheelDownSequence,
  readPromptFingerprint,
  screenContainsLine,
  screenSignature,
  waitForNextRender,
} from "./promptJump";
import { usePasteBatcher } from "./usePasteBatcher";
import { filterTerminalInput } from "./terminalInput";
import { countLines } from "./textTransform";
import { PasteConfirmDialog } from "./PasteConfirmDialog";
import { useTerminalSurfacePorts } from "../state/TerminalSurfacePortsContext";
import { useTerminalViewport } from "../state/TerminalViewportContext";
import { chordFromKeyboardEvent } from "../../../shared/keyboard";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

// Props:
// - terminalId: Tauri terminal handle; all terminal operations (write, key) are routed to the backend via this ID
// - kind: terminal type, "local" for local shell, "ssh" for remote connection
// - isActive: whether the current pane is active, determines focus/blur
// - onFocus: triggered when clicked, notifies parent to switch active pane
interface TerminalProps {
  terminalId: TerminalId;
  // tmux control-mode terminals use the same write/resize/close IPC
  // surface as local; the `kind` prop is informational (e.g. for
  // the `useClipboardImagePaste` branch on the `kind === "ssh"` path).
  kind?: "local" | "ssh" | "wsl" | "tmux-pane";
  isActive?: boolean;
  isWindowActive?: boolean;
  isConnected: boolean;
  configId: string;
  displayConfig?: TerminalDisplayConfig;
  bookmarks?: readonly TerminalBookmark[];
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
    terminalId,
    kind,
    isActive = true,
    isWindowActive = true,
    isConnected,
    configId: _configId,
    displayConfig,
    bookmarks,
    onFocus,
  },
  ref,
) {
  // containerRef: xterm.js actual DOM mount point; useXterm creates the Terminal instance inside this div
  const containerRef = useRef<HTMLDivElement>(null);
  // hostRef: positioned ancestor the gutter overlay is measured against (see useTerminalGutter)
  const hostRef = useRef<HTMLDivElement>(null);
  const gutterOverlayRef = useRef<HTMLDivElement>(null);
  const { currentTheme } = useTheme();
  const xtermOptions = { ...DEFAULT_XTERM_OPTIONS, ...displayConfig };
  const gutterEnabled = displayConfig?.gutterEnabled ?? true;
  const bookmarkLines = useMemo(
    () => (bookmarks ? bookmarks.map((bookmark) => bookmark.line) : []),
    [bookmarks],
  );
  // useXterm: initializes xterm.js, loads theme and applies xterm options; returns termRef (xterm instance) and fitAddonRef (auto-fit addon)
  const { termRef, fitAddonRef } = useXterm(containerRef, currentTheme, xtermOptions);

  const surfacePorts = useTerminalSurfacePorts();
  const keyboardPortsRef = useRef(surfacePorts.keyboard);
  const {
    write: writeTerminal,
    getEffectiveLocalEcho,
    reconnect: reconnectSession,
    uploadImage: uploadImageToSshTerminal,
    toggleBookmark: toggleBookmarkSession,
  } = surfacePorts.session;
  const { clipboard } = surfacePorts;
  const viewport = useTerminalViewport();
  const localEchoEnabled = getEffectiveLocalEcho(terminalId);
  const handleGutterLineClick = useCallback(
    (line: number) => {
      const text = termRef.current?.buffer.active.getLine(line)?.translateToString(true) ?? "";
      toggleBookmarkSession(terminalId, line, text);
    },
    [terminalId, termRef, toggleBookmarkSession],
  );

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

  const writeTerminalRef = useRef(writeTerminal);

  useEffect(() => {
    writeTerminalRef.current = writeTerminal;
  }, [writeTerminal]);

  useEffect(() => {
    keyboardPortsRef.current = surfacePorts.keyboard;
  }, [surfacePorts.keyboard]);

  const promptFingerprintRef = useRef("");

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const updateFingerprint = () => {
      if (term.buffer.active.type === "alternate") {
        promptFingerprintRef.current = readPromptFingerprint(term);
      }
    };
    const disposable = term.onRender(updateFingerprint);
    updateFingerprint();
    return () => disposable.dispose();
  }, [termRef]);

  const jumpToPrompt = useCallback(async (): Promise<boolean> => {
    const term = termRef.current;
    if (!term) return false;
    if (term.buffer.active.type !== "alternate") {
      term.scrollToBottom();
      return true;
    }
    const fingerprint = promptFingerprintRef.current.trimEnd();
    if (!fingerprint) return false;
    if (screenContainsLine(term, fingerprint)) return true;
    if (term.modes.mouseTrackingMode === "none") return false;
    const wheel = encodeWheelDownSequence(1, 1);
    let previous = screenSignature(term);
    for (let step = 0; step < MAX_PROMPT_JUMP_STEPS; step++) {
      writeTerminalRef.current(terminalId, wheel).catch((err) => {
        logger.error("terminal", "jumpToPrompt:wheel", err);
      });
      await waitForNextRender(term);
      if (screenContainsLine(term, fingerprint)) return true;
      const current = screenSignature(term);
      if (current === previous) break;
      previous = current;
    }
    return screenContainsLine(term, fingerprint);
  }, [terminalId, termRef]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    return viewport.register(terminalId, {
      getTopLine: () => term.buffer.active.viewportY,
      getBufferType: () => term.buffer.active.type,
      scrollToLine: (line) => term.scrollToLine(line),
      scrollToBottom: () => term.scrollToBottom(),
      jumpToPrompt,
    });
  }, [terminalId, termRef, viewport, jumpToPrompt]);

  // Perf 010: paste chunking + confirmation. The batcher owns rAF pacing so
  // a single paste doesn't hold the TerminalManager mutex across one giant
  // write_all; the dialog gives the user a chance to scrub line endings
  // and tabs before any bytes reach the PTY.
  // Bracketed-paste wrap (Perf 011 follow-up): xterm.js tracks DEC mode 2004
  // automatically via `terminal.modes.bracketedPasteMode`; we read it here
  // so vim/fzf/etc. receive the ESC[200~ / ESC[201~ markers when supported.
  const { enqueuePaste } = usePasteBatcher(terminalId);
  const [pendingPasteText, setPendingPasteText] = useState<string | null>(null);

  const readBracketedPasteMode = useCallback((): boolean => {
    return termRef.current?.modes.bracketedPasteMode === true;
  }, [termRef]);

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

  const restoreTerminalFocus = useCallback(() => {
    requestAnimationFrame(() => {
      if (isFocusedRef.current) {
        termRef.current?.focus();
      }
    });
  }, [termRef]);

  const handlePasteConfirm = useCallback(
    (transformedText: string) => {
      setPendingPasteText(null);
      enqueuePaste(transformedText, readBracketedPasteMode());
      restoreTerminalFocus();
    },
    [enqueuePaste, readBracketedPasteMode, restoreTerminalFocus],
  );

  const handlePasteCancel = useCallback(() => {
    setPendingPasteText(null);
    restoreTerminalFocus();
  }, [restoreTerminalFocus]);

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

      if (kind !== "ssh" && kind !== "tmux-pane") return;

      // Take over the paste synchronously: discovering an image may await the
      // Tauri clipboard fallback, and preventDefault must run before that.
      e.preventDefault();
      e.stopPropagation();
      const imageItems = await clipboard.readImages(e);
      if (imageItems.length === 0) return;

      for (const file of imageItems) {
        try {
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          const remotePath = await uploadImageToSshTerminal(
            terminalId,
            file.name,
            new Uint8Array(bytes),
          );
          writeTerminalRef.current(terminalId, remotePath).catch((err) => {
            logger.error("terminal", "writeTerminal:imagePath", err);
          });
        } catch (err) {
          console.error("[xsterm] Failed to upload pasted image:", err);
        }
      }
    },
    [clipboard, terminalId, kind, requestPaste, uploadImageToSshTerminal],
  );

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    isReconnectingRef.current = false;
    // When reconnecting, a brand-new PTY/SSH terminal is created, but the xterm instance still retains
    // the old terminal's mode state (e.g., mouse tracking mode). Without resetting these internal
    // states, xterm will still generate mouse event escape sequences on mouse movement and send them
    // to the new PTY, which has not enabled the corresponding mode, treating these sequences as
    // regular characters and displaying garbled output. reset() is equivalent to RIS, clearing the
    // screen and resetting all modes.
    xterm.reset();

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      const chord = chordFromKeyboardEvent(event);
      if (keyboardPortsRef.current.shouldBlockAppChord(chord)) {
        return false;
      }

      const terminalAction = keyboardPortsRef.current.resolveTerminalAction(chord);
      if (!terminalAction) return true;

      if (terminalAction === "terminal.copy") {
        const selection = xterm.getSelection();
        if (selection && selection.length > 0) {
          clipboard.writeText(selection).catch((err) => {
            console.error("[xsterm] Failed to copy selection via keyboard:", err);
          });
        }
        return false;
      }

      if (terminalAction === "terminal.paste") {
        event.preventDefault();
        clipboard
          .readText()
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

      if (terminalAction === "terminal.selectAll") {
        xterm.selectAll();
        return false;
      }

      if (terminalAction === "terminal.clear") {
        xterm.clear();
        return false;
      }

      return true;
    });

    const dataDisposer = xterm.onData((data) => {
      if (!isFocusedRef.current) return;

      if (!isConnectedRef.current) {
        if (data === "\r" && !isReconnectingRef.current) {
          isReconnectingRef.current = true;
          reconnectSessionRef.current(terminalId).finally(() => {
            isReconnectingRef.current = false;
          });
        }
        return;
      }

      const forwardedData = filterTerminalInput(kind, data);
      if (!forwardedData) return;

      if (localEchoEnabledRef.current) {
        xterm.write(forwardedData);
      }
      // Send the keystroke straight to the PTY. There used to be a
      // requestAnimationFrame batch here (Perf 003) that coalesced
      // multiple keystrokes per frame, but it also added a 1-frame
      // (~16 ms) display delay that users perceived as a character
      // showing up only on the *next* keystroke. With the Rust side
      // already coalescing reads into 64 KiB chunks (Perf 005), the
      // JS-side input batching buys nothing and only hurts latency.
      writeTerminalRef.current(terminalId, forwardedData).catch((err) => {
        logger.error("terminal", "writeTerminal:keystroke", err);
      });
    });

    const selectionDisposer = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection && selection.length > 0) {
        clipboard.writeText(selection).catch((err) => {
          console.error("[xsterm] Failed to copy selection on change:", err);
        });
      }
    });

    return () => {
      dataDisposer.dispose();
      selectionDisposer.dispose();
    };
  }, [clipboard, kind, requestPaste, terminalId, termRef]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste, true);
    return () => {
      document.removeEventListener("paste", handlePaste, true);
    };
  }, [handlePaste]);

  // useTauriTerminalOutput: subscribes to Tauri backend PTY output stream, writes data to xterm display
  // useTerminalResize: listens for container size changes, calls fitAddon.fit() to make xterm adapt to the new size
  useTauriTerminalOutput(termRef, terminalId);
  useTerminalResize(containerRef, termRef, fitAddonRef, terminalId, displayConfig, isWindowActive);
  useTerminalGutter({
    termRef,
    hostRef,
    overlayRef: gutterOverlayRef,
    terminalId,
    bookmarks: bookmarkLines,
    onLineClick: handleGutterLineClick,
    enabled: gutterEnabled,
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
            await clipboard.writeText(selection);
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
          const text = await clipboard.readText();
          if (text && isConnectedRef.current) {
            requestPaste(text);
          }
        } catch (err) {
          console.error("[xsterm] Failed to paste from clipboard:", err);
        }
      },
    }),
    [clipboard, requestPaste, termRef],
  );

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    if (isActive) {
      xterm.focus();
    } else {
      xterm.blur();
    }
  }, [isActive, termRef]);

  return (
    <div
      ref={hostRef}
      className={`terminal-host${gutterEnabled ? "" : " terminal-host--no-gutter"}`}
      onMouseDown={onFocus}
    >
      <div ref={gutterOverlayRef} className="terminal-gutter-overlay" aria-hidden="true" />
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
