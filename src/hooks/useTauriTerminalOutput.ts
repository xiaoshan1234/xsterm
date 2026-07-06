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

  // 监听 Tauri 后端事件，将终端输出写入 xterm 实例。
  // - paneId 存在时监听 tmux-pane-output 事件，针对特定 tmux pane 输出。
  // - 无 paneId 时监听 session-output 事件，针对整个会话输出。
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
