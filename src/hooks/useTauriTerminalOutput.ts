import { useEffect, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  appendSessionOutput,
  getSessionOutput,
} from "../utils/sessionOutputBuffer";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

// OSC52: ESC ] 52 ; [clipboard] ; <base64-data> ; terminated by BEL or ESC \
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

export function useTauriTerminalOutput(
  termRef: RefObject<XTerm | null>,
  sessionId: number
): void {
  // Listen to Tauri backend events and write terminal output to the xterm instance.
  // Data is batched via requestAnimationFrame to avoid frequent xterm.write() calls.
  // Also appends output to sessionOutputBuffer to restore historical content after pane remount.
  // On cleanup, cancels the event listener and flushes remaining queued data before exiting.
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    let listenerActive = true;
    let unlisten: (() => void) | null = null;
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
      if (!hasReplayed) return;
      queueWrite(text);
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
        const buffer = getSessionOutput(sessionId);
        if (buffer) {
          queueWrite(buffer);
        }
        hasReplayed = true;
      })
      .catch((err) => {
        if (listenerActive) {
          console.error("[xsterm] Failed to listen session-output:", err);
        }
      });

    return () => {
      listenerActive = false;
      unlisten?.();
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
  }, [termRef, sessionId]);
}
