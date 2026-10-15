// L4 — xterm theme 常量。
// 与 chrome tokens (L8) 完全独立:本文件不读 CSS 变量,见 DESIGN.md §3.2。
// 锁定 M0 内联主题,M5 主题切换时改这里 + 重建 xterm(Q5)。

import type { ITheme } from "@xterm/xterm";

export const XTERM_THEME: ITheme = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  black: "#1e1e1e",
  brightBlack: "#3a3a3a",
  red: "#ce9178",
  brightRed: "#f14c4c",
  green: "#6a9955",
  brightGreen: "#4ec9b0",
  yellow: "#dcdcaa",
  brightYellow: "#d7ba7d",
  blue: "#569cd6",
  brightBlue: "#9cdcfe",
  magenta: "#c586c0",
  brightMagenta: "#c586c0",
  cyan: "#4fc1ff",
  brightCyan: "#2bc4e2",
  white: "#d4d4d4",
  brightWhite: "#ffffff",
};
