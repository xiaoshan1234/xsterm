// L5 — 把 L2 (services) 和 L4 (xterm) 桥到 React 生命周期。
// 见 ARCHITECTURE §6 依赖图。
//
// M2 重构:不再 spawn,只接管 parent (usePaneTree) 已 spawn 的 sessionId,
// 订阅该 id 的 terminal-data / terminal-exit 并路由到 xterm。生命周期(spawn /
// close / reconnect)由 usePaneTree 统一编排。
//
// **race fix**:listener 不等 xterm ready 就订阅,output 在 xterm 还没准备好时
// 缓存到 bufferRef,xterm 落地后 flush。否则 spawn 后第一段输出(PowerShell
// 启动 banner / prompt)会丢失,用户看到空 xterm 或"无法正常打开"。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "../../adapter/xterm/xterm";

import type { SessionId } from "../../data/model/session";
import { onTerminalData, writeTerminal } from "../../data/service/pty";
import { onSessionExit } from "../../data/service/session";

export interface UseTerminalSessionOptions {
  sessionId: SessionId;
  onExit?: () => void;
}

export interface UseTerminalSessionResult {
  onTermReady: (term: Terminal) => void;
  isReady: boolean;
}

export function useTerminalSession(options: UseTerminalSessionOptions): UseTerminalSessionResult {
  const { sessionId, onExit } = options;
  const [xterm, setXterm] = useState<Terminal | null>(null);
  const [isReady, setIsReady] = useState(false);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const xtermRef = useRef<Terminal | null>(null);
  xtermRef.current = xterm;
  const bufferedRef = useRef<Uint8Array[]>([]);
  const decoderRef = useRef(new TextDecoder());

  const handleTermReady = useCallback((term: Terminal) => {
    setXterm(term);
    setIsReady(true);
  }, []);

  // xterm ready 后 flush buffer;之后 xterm 变更也走这个路径(reconnect)。
  useEffect(() => {
    if (!xterm) return;
    if (bufferedRef.current.length === 0) return;
    for (const chunk of bufferedRef.current) {
      xterm.write(decoderRef.current.decode(chunk));
    }
    bufferedRef.current = [];
  }, [xterm]);

  // 订阅:不等 xterm ready,提前缓冲
  useEffect(() => {
    let cancelled = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let firstDataLogged = false;

    (async () => {
      try {
        const d = await onTerminalData((payload) => {
          if (cancelled) return;
          if (payload.id !== sessionIdRef.current) return;
          const chunk = new Uint8Array(payload.data);
          const t = xtermRef.current;
          if (t) {
            t.write(decoderRef.current.decode(chunk));
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
          t.onData((keystroke) => {
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
    };
  }, [sessionId]);

  return { onTermReady: handleTermReady, isReady };
}
