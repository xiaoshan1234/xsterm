import { useEffect, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTerminalRuntime } from "../../sessions";
import {
  appendTerminalOutput,
  getTerminalOutput,
} from "../../../shared/utils/terminalOutputBuffer";
import { subscribeTerminalEvents, toBackendTerminalHandle } from "../infrastructure";
import { tmuxCommands } from "../../tmux/infrastructure";

const lastTouchRef = new Map<number, number>();
const TOUCH_DEBOUNCE_MS = 500;
/**
 * scrollback replay happens **once per tmux pane per mount**.
 * Keyed by the live xterm instance so React strict-mode double-mounts (which
 * dispose the first instance and create a second one) still replay on the
 * instance that actually survives.
 */
const replayedXterms = new WeakSet<XTerm>();

const SCROLLBACK_LINES = 2000;

function decodeOutput(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

// OSC52: ESC ] 52 ; [clipboard] ; <base64-data> ; terminated by BEL or ESC \
// eslint-disable-next-line no-control-regex -- ANSI escape sequences are required to detect OSC52.
const OSC52_REGEX = /\x1b\]52;[^;\x07\x1b]*;([A-Za-z0-9+/=]*)(?:\x07|\x1b\\)/g;

function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function extractAndCopyOsc52(text: string): string {
  // Fast skip: most PTY output has no OSC52; avoid regex alloc. See Perf 007.
  if (text.indexOf("\x1b]52;") === -1) return text;
  const matches = text.matchAll(OSC52_REGEX);
  for (const match of matches) {
    const encoded = match[1];
    if (!encoded || encoded.length === 0) continue;
    try {
      const decoded = decodeBase64Utf8(encoded);
      writeText(decoded).catch((err) => {
        console.error("[xsterm] Failed to write OSC52 selection to clipboard:", err);
      });
    } catch (err) {
      console.error("[xsterm] Failed to decode OSC52 selection:", err);
    }
  }
  return text.replace(OSC52_REGEX, "");
}

export function useTauriTerminalOutput(termRef: RefObject<XTerm | null>, terminalId: number): void {
  const { touchTerminalActivity, terminals } = useTerminalRuntime();
  // tmux scrollback replay applies only to tmux-backed panes.
  const isTmuxPane = !!terminals.find((s) => s.id === terminalId && !!s.tmuxPaneId);

  // replay tmux scrollback once per pane per app terminal. The
  // replay happens BEFORE the live listener attaches so the user sees
  // historical content first, then live output streams on top. The
  // `scrollbackReplayedRef` Set gates re-runs so a terminals-list update
  // that re-fires this effect does not double-replay. Errors are
  // non-fatal (the pane still works without replay).
  useEffect(() => {
    if (!isTmuxPane) return;
    const xterm = termRef.current;
    if (!xterm || replayedXterms.has(xterm)) return;
    replayedXterms.add(xterm);
    tmuxCommands
      .captureTmuxPane(toBackendTerminalHandle(terminalId), SCROLLBACK_LINES)
      .then((text) => {
        if (!text) return;
        try {
          xterm.write(text);
        } catch (e) {
          console.error("[xsterm] Failed to write tmux scrollback to terminal:", e);
        }
      })
      .catch((err) => {
        console.error("[xsterm] captureTmuxPane failed:", err);
      });
  }, [isTmuxPane, terminalId, termRef]);

  // TEMPORARY REVERT (Perf 001 follow-up): reverted from binary
  // Channel<Vec<u8>> path back to listen<[number, number[]]>. The
  // Tauri-2 production-binary path for `Channel` returned from a Tauri
  // command could not be unwrapped to a JS-side `Channel<Uint8Array>`
  // cleanly, which caused `useTauriTerminalOutput` to break and prevented
  // the Terminal component from setting up its `xterm.onData` input
  // listener — making the user unable to type. The binary wire format
  // (binary_frame.rs and sessionOutputFrame.ts) were removed during the
  // backend reorg; output now flows exclusively through the JSON
  // `terminal-output` event.
  //
  // ALSO: removed the rAF queueing that caused a 1-frame (~16 ms) display
  // delay for each typed character. Before Perf 005 the rAF was useful
  // because the Rust reader emitted one event per 8 KB read, so coalescing
  // JS-side events amortised xterm.write cost. With Perf 005 the Rust side
  // already coalesces into 64 KiB chunks (drain budget) and emits those
  // ~125 Hz, so the JS-side rAF was adding 16 ms latency on every single
  // keystroke echo with no remaining perf benefit. Each event now goes
  // straight to xterm.write.
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    let listenerActive = true;
    let unlisten: (() => void) | null = null;

    const handleOutput = (text: string) => {
      appendTerminalOutput(terminalId, text);

      const now = Date.now();
      const last = lastTouchRef.get(terminalId) ?? 0;
      if (now - last >= TOUCH_DEBOUNCE_MS) {
        lastTouchRef.set(terminalId, now);
        touchTerminalActivity(terminalId);
      }

      try {
        xterm.write(text);
      } catch (e) {
        console.error("[xsterm] Failed to write to terminal:", e);
      }
    };

    subscribeTerminalEvents({
      onOutput: ({ terminalHandle, data }) => {
        if (Number(terminalHandle) === terminalId) {
          handleOutput(extractAndCopyOsc52(decodeOutput(data)));
        }
      },
    })
      .then((fn) => {
        if (!listenerActive) {
          fn();
          return;
        }
        unlisten = fn;
        // Replay any history buffered before the listener was attached
        // (e.g. shell prompt that arrived during the listen() Promise
        // resolution window). The listener registers synchronously inside
        // listen() so this is best-effort, not a strict race-free path.
        const buffer = getTerminalOutput(terminalId);
        if (buffer) {
          try {
            xterm.write(buffer);
          } catch (e) {
            console.error("[xsterm] Failed to replay terminal output buffer:", e);
          }
        }
      })
      .catch((err) => {
        if (listenerActive) {
          console.error("[xsterm] Failed to listen terminal-output:", err);
        }
      });

    return () => {
      listenerActive = false;
      unlisten?.();
    };
  }, [termRef, terminalId, touchTerminalActivity]);
}
