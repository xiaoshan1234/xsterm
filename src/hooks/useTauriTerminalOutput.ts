import { useEffect, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";

function decodeOutput(data: number[]): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

interface PendingWrite {
  text: string;
  resolve: () => void;
}

export function useTauriTerminalOutput(
  termRef: RefObject<XTerm | null>,
  sessionId: number
): void {
  // 监听 Tauri 后端事件，将终端输出写入 xterm 实例。
  // 数据通过 requestAnimationFrame 批量写入，避免频繁调用 xterm.write()。
  // 清理时取消事件监听，并将队列中剩余数据一次性写入后退出。
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    let listenerActive = true;
    let unlisten: (() => void) | null = null;
    let rafId: number | null = null;
    let writeQueue: PendingWrite[] = [];

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

    listen<[number, number[]]>("session-output", (event) => {
      const [id, data] = event.payload;
      if (id === sessionId) {
        queueWrite(decodeOutput(data));
      }
    })
      .then((fn) => {
        if (listenerActive) {
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
