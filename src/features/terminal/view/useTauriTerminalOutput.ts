import { useEffect, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTerminalRuntime } from "../../sessions";
import {
  appendTerminalOutput,
  getTerminalOutput,
} from "../../../shared/utils/terminalOutputBuffer";
import { subscribeTerminalOutput, toBackendTerminalHandle } from "../infrastructure";
import { tmuxCommands } from "../../tmux/infrastructure";
import { normalizeCapturedScrollback } from "./scrollback";

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
          xterm.write(normalizeCapturedScrollback(text));
        } catch (e) {
          console.error("[xsterm] Failed to write tmux scrollback to terminal:", e);
        }
      })
      .catch((err) => {
        console.error("[xsterm] captureTmuxPane failed:", err);
      });
  }, [isTmuxPane, terminalId, termRef]);

  // Raw-byte output path: the frontend hands the backend a Tauri `Channel`,
  // and the Rust forwarder pushes coalesced bytes through it as raw binary.
  // Each chunk arrives here as an `ArrayBuffer`, avoiding the historical JSON
  // number-array (`[104,105,...]`) blow-up. The Rust side already coalesces
  // reads into 64 KiB / 8 ms bursts, so each chunk goes straight to
  // xterm.write with no JS-side rAF batching.
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

    subscribeTerminalOutput(terminalId, (data) => {
      if (!listenerActive) return;
      handleOutput(extractAndCopyOsc52(decodeOutput(data)));
    })
      .then((fn) => {
        if (!listenerActive) {
          fn();
          return;
        }
        unlisten = fn;
        // Replay any history buffered before this subscription attached
        // (e.g. shell prompt that arrived during the subscribe() Promise
        // resolution window). Best-effort, not a strict race-free path.
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
