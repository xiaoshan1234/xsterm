import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useSession } from "../contexts/SessionContext";
import { useTheme } from "../contexts/ThemeContext";
import { uploadImageToSshSession } from "../services/sessionService";
import { getClipboardImages } from "../utils/clipboard";
import { useXterm } from "../hooks/useXterm";
import { useTauriTerminalOutput } from "../hooks/useTauriTerminalOutput";
import { useTerminalResize } from "../hooks/useTerminalResize";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
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
  isWindowActive?: boolean;
  isConnected: boolean;
  configId: string;
  onFocus?: () => void;
}

export interface TerminalRef {
  selectAll: () => void;
  copySelection: () => Promise<void>;
  clear: () => void;
}

const XTERM_OPTIONS = {
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorBlink: true,
  screenReaderMode: false,
};

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  { sessionId, sessionType, isActive = true, isWindowActive = true, isConnected, configId: _configId, onFocus },
  ref
) {
  // containerRef: xterm.js 的实际 DOM 挂载点，useXterm 会在此 div 内创建 Terminal 实例
  const containerRef = useRef<HTMLDivElement>(null);
  const { currentTheme } = useTheme();
  // useXterm: 初始化 xterm.js，加载主题和应用 xterm options；返回 termRef（xterm 实例）和 fitAddonRef（自适应尺寸插件）
  const { termRef, fitAddonRef } = useXterm(containerRef, currentTheme, XTERM_OPTIONS);

  const { writeSession, getEffectiveLocalEcho, reconnectSession } = useSession();
  const localEchoEnabled = getEffectiveLocalEcho(sessionId);

  const localEchoEnabledRef = useRef(localEchoEnabled);
  const lastDataRef = useRef<{ text: string; time: number } | null>(null);
  const isFocusedRef = useRef(isActive);
  const isConnectedRef = useRef(isConnected);
  const isReconnectingRef = useRef(false);
  const reconnectSessionRef = useRef(reconnectSession);
  const lastKeyboardPasteRef = useRef<{ time: number; text: string } | null>(null);

  useEffect(() => {
    isFocusedRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    localEchoEnabledRef.current = localEchoEnabled;
  }, [localEchoEnabled]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    reconnectSessionRef.current = reconnectSession;
  }, [reconnectSession]);

  const writeSessionRef = useRef(writeSession);

  useEffect(() => {
    writeSessionRef.current = writeSession;
  }, [writeSession]);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const target = e.target as Node | null;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) return;

      const text = e.clipboardData?.getData("text") || e.clipboardData?.getData("text/plain");

      const lastKeyboardPaste = lastKeyboardPasteRef.current;
      if (lastKeyboardPaste && Date.now() - lastKeyboardPaste.time < 100) {
        if (text) {
          e.preventDefault();
          e.stopPropagation();
        }
        lastKeyboardPasteRef.current = null;
        return;
      }

      if (text) {
        e.preventDefault();
        e.stopPropagation();
        if (isConnectedRef.current) {
          writeSessionRef.current(sessionId, text);
          lastDataRef.current = { text, time: Date.now() };
        }
        return;
      }

      if (sessionType !== "ssh") return;

      const imageItems = await getClipboardImages(e);
      if (imageItems.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

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

    isReconnectingRef.current = false;
    // 重新连接时创建了一个全新的 PTY/SSH session，xterm 实例却依旧保留旧 session 的
    // 模式状态（如鼠标追踪模式）。如果不重置这些内部状态，xterm 仍会在鼠标移动时
    // 生成鼠标事件转义序列并发送给新 PTY，而新的 PTY 没有启用对应模式，就会把这些
    // 序列当普通字符显示，导致乱码。reset() 相当于 RIS，清除屏幕并重置所有模式。
    xterm.reset();

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      const copyShortcut = (event.ctrlKey && event.shiftKey && (event.key === "c" || event.key === "C")) ||
        (event.ctrlKey && event.key === "Insert") ||
        (event.metaKey && (event.key === "c" || event.key === "C"));

      if (copyShortcut) {
        const selection = xterm.getSelection();
        if (selection && selection.length > 0) {
          writeText(selection).catch((err) => {
            console.error("[xsterm] Failed to copy selection via keyboard:", err);
          });
        }
        return false;
      }

      const pasteShortcut = (event.ctrlKey && event.shiftKey && (event.key === "v" || event.key === "V")) ||
        (event.shiftKey && event.key === "Insert") ||
        (event.metaKey && (event.key === "v" || event.key === "V"));

      if (pasteShortcut && isConnectedRef.current) {
        lastKeyboardPasteRef.current = { time: Date.now(), text: "" };
        readText().then((text) => {
          if (text) {
            lastKeyboardPasteRef.current = { time: Date.now(), text };
            writeSessionRef.current(sessionId, text);
            lastDataRef.current = { text, time: Date.now() };
          }
        }).catch((err) => {
          console.error("[xsterm] Failed to paste text from clipboard:", err);
        });
        return false;
      }

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

      if (!isConnectedRef.current) {
        if (data === "\r" && !isReconnectingRef.current) {
          isReconnectingRef.current = true;
          reconnectSessionRef.current(sessionId).finally(() => {
            isReconnectingRef.current = false;
          });
        }
        return;
      }

      const now = Date.now();
      const last = lastDataRef.current;
      if (last && last.text === data && now - last.time < 100) {
        return;
      }
      lastDataRef.current = { text: data, time: now };

      if (localEchoEnabledRef.current) {
        xterm.write(data);
      }
      writeSessionRef.current(sessionId, data);
    });

    const selectionDisposer = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection && selection.length > 0) {
        writeText(selection).catch((err) => {
          console.error("[xsterm] Failed to copy selection on change:", err);
        });
      }
    });

    return () => {
      dataDisposer.dispose();
      selectionDisposer.dispose();
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
  useTerminalResize(containerRef, termRef, fitAddonRef, sessionId, isWindowActive);

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
          try {
            await writeText(selection);
          } catch (err) {
            console.error("[xsterm] Failed to copy selection to clipboard:", err);
          }
        }
      },
      clear: () => {
        termRef.current?.clear();
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
