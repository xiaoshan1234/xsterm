import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { uploadImageToSshSession } from "../services/sessionService";
import { getClipboardImages } from "../utils/clipboard";
import { useXterm } from "../hooks/useXterm";
import { useTauriTerminalOutput } from "../hooks/useTauriTerminalOutput";
import { useTerminalResize } from "../hooks/useTerminalResize";
import "@xterm/xterm/css/xterm.css";

// Props 说明：
// - sessionId: Tauri session 句柄，所有 terminal 操作（写入、按键）都通过此 ID 路由到后端
// - sessionType: 会话类型，local 为本地 shell，ssh 为远程连接
// - isActive: 当前窗格是否为激活状态，决定 focus/blur
// - onFocus: 被点击时触发，通知父组件切换激活窗格
interface TerminalProps {
  sessionId: number;
  sessionType?: "local" | "ssh";
  isActive?: boolean;
  onFocus?: () => void;
}

export interface TerminalRef {
  selectAll: () => void;
  copySelection: () => Promise<void>;
}

const XTERM_OPTIONS = {
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorBlink: true,
  screenReaderMode: false,
};

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  { sessionId, sessionType, isActive = true, onFocus },
  ref
) {
  // containerRef: xterm.js 的实际 DOM 挂载点，useXterm 会在此 div 内创建 Terminal 实例
  const containerRef = useRef<HTMLDivElement>(null);
  const { currentTheme } = useTheme();
  // useXterm: 初始化 xterm.js，加载主题和应用 xterm options；返回 termRef（xterm 实例）和 fitAddonRef（自适应尺寸插件）
  const { termRef, fitAddonRef } = useXterm(containerRef, currentTheme, XTERM_OPTIONS);

  const { writeSession, getEffectiveLocalEcho } = useSession();
  const localEchoEnabled = getEffectiveLocalEcho(sessionId);

  const localEchoEnabledRef = useRef(localEchoEnabled);
  const lastDataRef = useRef<{ text: string; time: number } | null>(null);
  const isFocusedRef = useRef(isActive);

  useEffect(() => {
    isFocusedRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    localEchoEnabledRef.current = localEchoEnabled;
  }, [localEchoEnabled]);

  const writeSessionRef = useRef(writeSession);

  useEffect(() => {
    writeSessionRef.current = writeSession;
  }, [writeSession]);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (sessionType !== "ssh") return;

      const target = e.target as Node | null;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) return;

      const imageItems = await getClipboardImages(e);
      if (imageItems.length === 0) return;

      e.preventDefault();

      for (const file of imageItems) {
        try {
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          const remotePath = await uploadImageToSshSession(sessionId, file.name, bytes);
          writeSessionRef.current(sessionId, remotePath);
        } catch (err) {
          console.error("[xsterm] Failed to upload pasted image:", err);
        }
      }
    },
    [sessionId, sessionType]
  );

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && (event.key === "n" || event.key === "N") && event.shiftKey) {
        return false;
      }
      if (event.ctrlKey && event.key === "Tab") {
        return false;
      }
      if (event.ctrlKey && (event.key === "w" || event.key === "W")) {
        return false;
      }
      if (event.ctrlKey && (event.key === "l" || event.key === "L")) {
        return false;
      }
      if (event.ctrlKey && event.key === ",") {
        return false;
      }
      return true;
    });

    const dataDisposer = xterm.onData((data) => {
      if (!isFocusedRef.current) return;

      const now = Date.now();
      const last = lastDataRef.current;
      if (last && last.text === data && now - last.time < 30) {
        return;
      }
      lastDataRef.current = { text: data, time: now };

      if (localEchoEnabledRef.current) {
        xterm.write(data);
      }
      writeSessionRef.current(sessionId, data);
    });

    return () => {
      dataDisposer.dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste, true);
    return () => {
      document.removeEventListener("paste", handlePaste, true);
    };
  }, [handlePaste]);

  // useTauriTerminalOutput: 订阅 Tauri 后端 PTY 输出流，将数据写入 xterm 显示
  // useTerminalResize: 监听容器尺寸变化，调用 fitAddon.fit() 让 xterm 自适应新尺寸
  useTauriTerminalOutput(termRef, sessionId);
  useTerminalResize(containerRef, termRef, fitAddonRef, sessionId);

  // 通过 ref 暴露 xterm 操作给父组件：selectAll（全选）、copySelection（复制选中内容）
  useImperativeHandle(
    ref,
    () => ({
      selectAll: () => {
        termRef.current?.selectAll();
      },
      copySelection: async () => {
        const selection = termRef.current?.getSelection();
        if (selection) {
          await navigator.clipboard.writeText(selection).catch(() => {});
        }
      },
    }),
    []
  );

  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    if (isActive) {
      xterm.focus();
    } else {
      xterm.blur();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
      onMouseDown={onFocus}
    />
  );
});

export default Terminal;
