import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useSession } from "../contexts/SessionContext";

export function useTerminalResize(
  containerRef: RefObject<HTMLDivElement | null>,
  termRef: RefObject<XTerm | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  sessionId: number
): void {
  const { resizeSession } = useSession();
  const resizeSessionRef = useRef(resizeSession);

  useEffect(() => {
    resizeSessionRef.current = resizeSession;
  }, [resizeSession]);

  // 使用 ResizeObserver 监听容器尺寸变化，触发 fitAddon.fit() 使 xterm 自适应新尺寸，
  // 并将 rows/cols 通知给 Tauri 后端以调整 PTY 大小。
  // 防抖逻辑：容器变化时延迟 150ms 再执行 fitAndResize，避免频繁 resize。
  // 初始化时通过多个 requestAnimationFrame/setTimeout 确保尺寸正确应用（延迟 0/300/800ms 各执行一次）。
  // 清理时断开 ResizeObserver 并取消所有 pending 的 raf/timeout。
  useEffect(() => {
    const container = containerRef.current;
    const xterm = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !xterm || !fitAddon) return;

    let initDone = false;
    let resizeTimer: number | null = null;
    const timeoutIds: number[] = [];

    const fitAndResize = () => {
      if (fitAddonRef.current && container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddonRef.current.fit();
        resizeSessionRef.current(sessionId, xterm.rows, xterm.cols);
      }
    };

    const debouncedFitAndResize = () => {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (initDone) {
          fitAndResize();
        }
      }, 150);
    };

    const resizeObserver = new ResizeObserver(() => {
      debouncedFitAndResize();
    });
    resizeObserver.observe(container);

    const initRafId = requestAnimationFrame(() => {
      fitAndResize();
      initDone = true;
      timeoutIds.push(window.setTimeout(fitAndResize, 300));
      timeoutIds.push(window.setTimeout(fitAndResize, 800));
    });

    return () => {
      resizeObserver.disconnect();
      if (initRafId !== null) {
        cancelAnimationFrame(initRafId);
      }
      timeoutIds.forEach((id) => clearTimeout(id));
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
    };
  }, [containerRef, termRef, fitAddonRef, sessionId]);
}
