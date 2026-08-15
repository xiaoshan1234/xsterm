import { useEffect, useRef, RefObject } from "react";
import { Terminal as XTerm, ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalTheme } from "../types/theme";

export function themeToXtermTheme(theme: TerminalTheme) {
  return {
    foreground: theme.foreground,
    background: theme.background,
    cursor: theme.cursor,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

export interface UseXtermResult {
  termRef: RefObject<XTerm | null>;
  fitAddonRef: RefObject<FitAddon | null>;
}

// Keys we forward to xterm.options.set(); theme is handled separately.
// xterm-unsupported fields (lineTimestamp, reverseVideo, mouseWheelScrollLines,
// fitOnResize, syncRemoteTitle, backspaceSends, deleteSends, lineFeedMode,
// cursorKeyMode, keypadMode, modifyOtherKeysFormat, altSendsEscape,
// wordSeparatorChars, altScreenWordSeparatorChars, clipboardRead, clipboardWrite,
// logging) are intentionally kept in config but NOT applied (avoid xterm throw).
const SETTABLE_KEYS = [
  "fontSize",
  "fontFamily",
  "cursorBlink",
  "cursorStyle",
  "cursorWidth",
  "scrollback",
  "lineHeight",
  "letterSpacing",
  "autoWrap",
] as const;

// Map spec field names to xterm.js option names where they differ.
const XTERM_OPTION_MAP: Record<string, string> = {
  autoWrap: "convertEol",
};

export function useXterm(
  containerRef: RefObject<HTMLDivElement | null>,
  theme: TerminalTheme,
  options: ITerminalOptions
): UseXtermResult {
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const optionsRef = useRef(options);
  const themeRef = useRef(theme);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // 在 containerRef 指向的 DOM 元素上创建 xterm 实例。
  // 每个 Terminal 组件拥有独立的 xterm 实例，通过 ref 暴露给外部。
  // FitAddon 同时加载到 xterm 上，用于根据容器尺寸自动调整终端大小。
  // 组件卸载时调用 dispose() 销毁实例并将 ref 置空，防止内存泄漏。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new XTerm({
      ...optionsRef.current,
      theme: themeToXtermTheme(themeRef.current),
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    xterm.open(container);

    termRef.current = xterm;
    fitAddonRef.current = fitAddon;

    return () => {
      xterm.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef]);

  // 主题变更时同步更新 xterm 实例的 theme 配置。
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    xterm.options.theme = themeToXtermTheme(theme);
  }, [theme]);

  // Display options 变更时同步更新 xterm 实例的可热更新配置。
  useEffect(() => {
    const xterm = termRef.current;
    if (!xterm) return;
    for (const key of SETTABLE_KEYS) {
      const value = (options as Record<string, unknown>)[key];
      if (value !== undefined) {
        const xtermKey = XTERM_OPTION_MAP[key] ?? key;
        (xterm.options as Record<string, unknown>)[xtermKey] = value;
      }
    }
    xterm.refresh(0, xterm.rows - 1);
  }, [
    options.fontSize,
    options.fontFamily,
    options.cursorBlink,
    options.cursorStyle,
    options.cursorWidth,
    options.scrollback,
    options.lineHeight,
    options.letterSpacing,
    (options as Record<string, unknown>).autoWrap,
  ]);

  return { termRef, fitAddonRef };
}
