import { Terminal as XTerm, type ITheme } from "@xterm/xterm";

export const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace";
export const DEFAULT_FONT_SIZE = 14;

export interface CreateXtermOptions {
  theme: ITheme;
  fontSize?: number;
  fontFamily?: string;
}

export function createXterm(options: CreateXtermOptions): XTerm {
  return new XTerm({
    fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    cursorBlink: true,
    theme: options.theme,
  });
}

// L5/L7 拿 xterm 类型走这条 re-export,避免直接 import @xterm/*(R3)。
export type { Terminal } from "@xterm/xterm";
export type XtermInstance = XTerm;
