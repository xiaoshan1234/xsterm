// L5 — 把 L2 (services) 和 L4 (xterm) 桥到 React 生命周期。
// 见 ARCHITECTURE §6 依赖图。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "../lib/xterm/xterm";

import { DEFAULT_SHELL, type ShellKind } from "../domain/shell";
import type { SessionId } from "../domain/session";
import { onTerminalData, spawnTerminal, writeTerminal } from "../services/pty";

export interface UseTerminalSessionOptions {
  shell?: ShellKind;
}

export interface UseTerminalSessionResult {
  onTermReady: (term: Terminal) => void;
  isReady: boolean;
}

export function useTerminalSession(
  options: UseTerminalSessionOptions = {},
): UseTerminalSessionResult {
  const shell = options.shell ?? DEFAULT_SHELL;
  const [xterm, setXterm] = useState<Terminal | null>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const [isReady, setIsReady] = useState(false);

  const handleTermReady = useCallback((term: Terminal) => {
    setXterm(term);
  }, []);

  useEffect(() => {
    if (!xterm) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const id = await spawnTerminal({ rows: xterm.rows, cols: xterm.cols, shell });
        if (cancelled) return;
        sessionIdRef.current = id;
        setIsReady(true);

        const handle = await onTerminalData((data) => {
          if (cancelled) return;
          const text = new TextDecoder().decode(new Uint8Array(data));
          xterm.write(text);
        });
        unlisten = handle;

        xterm.onData((keystroke) => {
          if (sessionIdRef.current === null) return;
          const bytes = Array.from(keystroke).map((c) => c.charCodeAt(0));
          writeTerminal(sessionIdRef.current, new Uint8Array(bytes)).catch((err) => {
            console.error("writeTerminal failed:", err);
          });
        });
      } catch (err) {
        xterm.writeln(`Failed to spawn terminal: ${err}`);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [xterm, shell]);

  return { onTermReady: handleTermReady, isReady };
}
