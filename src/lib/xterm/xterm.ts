import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";

export const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace";
export const DEFAULT_FONT_SIZE = 14;

export interface CreateXtermOptions {
  theme: ITheme;
  fontSize?: number;
  fontFamily?: string;
}

export interface CreatedXterm {
  term: XTerm;
  fitAddon: FitAddon;
}

export function createXterm(options: CreateXtermOptions): CreatedXterm {
  const term = new XTerm({
    fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    cursorBlink: true,
    theme: options.theme,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  return { term, fitAddon };
}

// L5/L7 通过这条 re-export 拿 xterm 类型,避免直接 import @xterm/*(R3)。
export type { Terminal } from "@xterm/xterm";
export type XtermInstance = XTerm;
