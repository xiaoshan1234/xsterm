// L5 — 把 L2 (services) 和 L4 (xterm) 桥到 React 生命周期。
// 见 ARCHITECTURE §6 依赖图。
//
// 设计:**xterm 由 PaneChrome 拥有**,useTerminalSession 通过 prop 接收同一份
// 引用。这样 listener 收到的数据直接写到 PaneChrome 正在渲染的那个 xterm。
// 早期版本 useTerminalSession 内部维护自己的 xterm state,跟 PaneChrome 断开了,
// 导致 listener 写入的数据在视觉上看不到(经典 stale-state 坑)。
//
// 仍然保留 buffer:在 xterm 还没就绪的极短窗口内(典型 < 50ms),先入 buffer,
// xterm 落地后 flush。

import { useEffect, useRef } from "react";
import type { Terminal } from "../../adapter/xterm/xterm";

import type { SessionId } from "../../data/model/session";
import { onTerminalData, writeTerminal } from "../../data/service/pty";
import { onSessionExit } from "../../data/service/session";

export interface UseTerminalSessionOptions {
  sessionId: SessionId;
  xterm: Terminal | null;
  onExit?: () => void;
}

const decoder = new TextDecoder();

export function useTerminalSession({ sessionId, xterm, onExit }: UseTerminalSessionOptions): void {
  // 用 ref 跟踪最新值,避免 listener / onData 闭包过期
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const xtermRef = useRef<Terminal | null>(xterm);
  xtermRef.current = xterm;
  const bufferedRef = useRef<Uint8Array[]>([]);

  // xterm 落地后 flush buffer
  useEffect(() => {
    if (!xterm) return;
    if (bufferedRef.current.length === 0) return;
    for (const chunk of bufferedRef.current) {
      xterm.write(decoder.decode(chunk));
    }
    bufferedRef.current = [];
  }, [xterm]);

  // 订阅 terminal-data / terminal-exit + 设 xterm.onData 输入
  useEffect(() => {
    let cancelled = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let onDataDisposer: { dispose: () => void } | null = null;
    let firstDataLogged = false;

    (async () => {
      try {
        const d = await onTerminalData((payload) => {
          if (cancelled) return;
          if (payload.id !== sessionIdRef.current) return;
          const chunk = new Uint8Array(payload.data);
          const t = xtermRef.current;
          if (t) {
            t.write(decoder.decode(chunk));
          } else {
            bufferedRef.current.push(chunk);
          }
          if (!firstDataLogged) {
            firstDataLogged = true;
            console.debug(
              `[useTerminalSession] first data for session ${sessionIdRef.current}, ${chunk.length} bytes`,
            );
          }
        });
        if (cancelled) {
          d();
          return;
        }
        unlistenData = d;

        const e = await onSessionExit((payload) => {
          if (cancelled) return;
          if (payload.id !== sessionIdRef.current) return;
          onExitRef.current?.();
        });
        if (cancelled) {
          e();
          unlistenData?.();
          return;
        }
        unlistenExit = e;

        const t = xtermRef.current;
        if (t) {
          onDataDisposer = t.onData((keystroke) => {
            const bytes = Array.from(keystroke).map((c) => c.charCodeAt(0));
            writeTerminal(sessionIdRef.current, new Uint8Array(bytes)).catch((err) => {
              console.error("writeTerminal failed:", err);
            });
          });
        }
      } catch (err) {
        console.error("useTerminalSession failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlistenData?.();
      unlistenExit?.();
      onDataDisposer?.dispose();
    };
  }, [sessionId]);
}
