import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../contexts/SessionContext";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

interface PendingWrite {
  text: string;
  resolve: () => void;
}

export function useTauriTerminalOutput(
  termRef: RefObject<XTerm | null>,
  sessionId: number,
  _sessionType?: "local" | "ssh",
  paneId?: string
): void {
  const { captureTmuxPane } = useSession();
  const captureTmuxPaneRef = useRef(captureTmuxPane);

  useEffect(() => {
    captureTmuxPaneRef.current = captureTmuxPane;
  }, [captureTmuxPane]);

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    let listenerActive = true;
    let unlisten: (() => void) | null = null;
    let rafId: number | null = null;
    let writeQueue: PendingWrite[] = [];

    const flushWrites = () => {
      rafId = null;
      if (writeQueue.length === 0 || !termRef.current) return;
      const pending = writeQueue;
      writeQueue = [];
      const text = pending.map((w) => w.text).join("");
      termRef.current.write(text, () => {
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
      })
        .then((fn) => {
          if (listenerActive && termRef.current) {
            unlisten = fn;
            captureTmuxPaneRef.current(sessionId, paneId).catch((err) => {
              console.error("[xsterm] Failed to capture tmux pane:", err);
            });
          } else {
            fn();
          }
        })
        .catch((err) => {
          if (listenerActive) {
            console.error("[xsterm] Failed to listen tmux-pane-output:", err);
          }
        });
    } else {
      listen<[number, number[]]>("session-output", (event) => {
        const [id, data] = event.payload;
        if (id === sessionId) {
          queueWrite(decodeOutput(data));
        }
      })
        .then((fn) => {
          if (listenerActive && termRef.current) {
            unlisten = fn;
          } else {
            fn();
          }
        })
        .catch((err) => {
          if (listenerActive) {
            console.error("[xsterm] Failed to listen session-output:", err);
          }
        });
    }

    return () => {
      listenerActive = false;
      unlisten?.();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        if (termRef.current) {
          termRef.current.write(writeQueue.map((w) => w.text).join(""));
        }
      }
    };
  }, [termRef, sessionId, paneId]);
}
