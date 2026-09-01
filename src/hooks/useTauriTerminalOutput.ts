import { useEffect, type RefObject } from "react";
import { type Terminal as XTerm } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSession } from "../contexts/SessionContext";
import { appendSessionOutput, getSessionOutput } from "../utils/sessionOutputBuffer";
import { getSessionOutputChannel, onSessionOutput } from "./sessionOutputChannel";

const lastTouchRef = new Map<number, number>();
const TOUCH_DEBOUNCE_MS = 500;

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

interface PendingWrite {
  text: string;
  resolve: () => void;
}

export function useTauriTerminalOutput(termRef: RefObject<XTerm | null>, sessionId: number): void {
  const { setSessions } = useSession();

  // Perf 001: subscribe to the global binary `session-output` Channel
  // (one Tauri Channel for the whole app, dispatched by session_id inside
  // the frame). Replaces the historical `listen<[number, number[]]>("session-output", ...)`
  // path that serialized 1 MB of PTY output as a JSON array of numbers.
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    let listenerActive = true;
    let rafId: number | null = null;
    let writeQueue: PendingWrite[] = [];
    let hasReplayed = false;

    const flushWrites = () => {
      rafId = null;
      if (writeQueue.length === 0) return;
      const pending = writeQueue;
      writeQueue = [];
      const text = pending.map((w) => w.text).join("");
      try {
        xterm.write(text, () => {
          for (const w of pending) {
            w.resolve();
          }
        });
      } catch (e) {
        console.error("[xsterm] Failed to write to terminal:", e);
        for (const w of pending) {
          w.resolve();
        }
      }
    };

    const queueWrite = (text: string): Promise<void> => {
      return new Promise((resolve) => {
        writeQueue.push({ text, resolve });
        if (rafId === null) {
          rafId = requestAnimationFrame(flushWrites);
        }
      });
    };

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

      if (!hasReplayed) return;
      queueWrite(text);
    };

    // Subscribe to this session's slice of the binary channel. The
    // singleton channel is fetched lazily — first caller does the round
    // trip to Rust, every subsequent caller joins the same channel.
    const unsubscribe = onSessionOutput(sessionId, (data) => {
      if (!listenerActive) return;
      // Bytes → text. The session-output forwarder already trimmed to a
      // UTF-8 safe boundary (see Perf 005), so a fresh TextDecoder per
      // chunk is safe and avoids the streaming-decoder statefulness tax.
      const text = new TextDecoder().decode(data);
      handleOutput(extractAndCopyOsc52(text));
    });

    // Kick off (and cache) the channel fetch. We don't await — the
    // channel setup is idempotent and lazily bound.
    getSessionOutputChannel().catch((err) => {
      if (listenerActive) {
        console.error("[xsterm] Failed to fetch session-output channel:", err);
      }
    });

    // Replay any buffered history for this session — same as the legacy
    // listener did, decoupled from the channel subscription.
    const buffer = getSessionOutput(sessionId);
    if (buffer) {
      queueWrite(buffer);
    }
    hasReplayed = true;

    return () => {
      listenerActive = false;
      unsubscribe();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (writeQueue.length > 0) {
        const pending = writeQueue;
        writeQueue = [];
        const text = pending.map((w) => w.text).join("");
        try {
          xterm.write(text, () => {
            for (const w of pending) {
              w.resolve();
            }
          });
        } catch (e) {
          console.error("[xsterm] Failed to flush terminal writes:", e);
          for (const w of pending) {
            w.resolve();
          }
        }
      }
    };
  }, [termRef, sessionId, setSessions]);
}