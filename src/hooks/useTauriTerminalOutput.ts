import { useEffect, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSession } from "../contexts/SessionContext";
import { appendSessionOutput, getSessionOutput } from "../utils/sessionOutputBuffer";

const lastTouchRef = new Map<number, number>();
const TOUCH_DEBOUNCE_MS = 500;

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
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

export function useTauriTerminalOutput(termRef: RefObject<XTerm | null>, sessionId: number): void {
  const { setSessions } = useSession();

  // TEMPORARY REVERT (Perf 001 follow-up): reverted from binary
  // Channel<Vec<u8>> path back to listen<[number, number[]]>. The
  // Tauri-2 production-binary path for `Channel` returned from a Tauri
  // command could not be unwrapped to a JS-side `Channel<Uint8Array>`
  // cleanly, which caused `useTauriTerminalOutput` to break and prevented
  // the Terminal component from setting up its `xterm.onData` input
  // listener — making the user unable to type. The binary wire format
  // (`src-tauri/src/infrastructure/binary_frame.rs`,
  // `src/hooks/sessionOutputFrame.ts`) stays in place under
  // `#[allow(dead_code)]` so we can flip the switch back on once the
  // Tauri 2 channel-on-command path is understood.
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
      appendSessionOutput(sessionId, text);

      const now = Date.now();
      const last = lastTouchRef.get(sessionId) ?? 0;
      if (now - last >= TOUCH_DEBOUNCE_MS) {
        lastTouchRef.set(sessionId, now);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, lastActivityAt: now } : s)),
        );
      }

      try {
        xterm.write(text);
      } catch (e) {
        console.error("[xsterm] Failed to write to terminal:", e);
      }
    };

    listen<[number, number[]]>("session-output", (event) => {
      const [id, data] = event.payload;
      if (id === sessionId) {
        handleOutput(extractAndCopyOsc52(decodeOutput(data)));
      }
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
        const buffer = getSessionOutput(sessionId);
        if (buffer) {
          try {
            xterm.write(buffer);
          } catch (e) {
            console.error("[xsterm] Failed to replay session output buffer:", e);
          }
        }
      })
      .catch((err) => {
        if (listenerActive) {
          console.error("[xsterm] Failed to listen session-output:", err);
        }
      });

    return () => {
      listenerActive = false;
      unlisten?.();
    };
  }, [termRef, sessionId, setSessions]);
}