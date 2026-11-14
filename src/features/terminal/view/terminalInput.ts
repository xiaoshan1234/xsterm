import type { TerminalKind } from "../../../models/legacy/terminal";

const ESC = String.fromCharCode(0x1b);
const TMUX_DEVICE_ATTRIBUTES_REPLY = new RegExp(`${ESC}\\[\\?1;2c`, "g");

/**
 * xterm automatically answers `CSI c` with `ESC[?1;2c`. tmux passthrough
 * forwards the query to xterm, but control mode can only inject the reply as
 * pane input. Once the TUI exits, that late reply is echoed by the shell as
 * visible `1;2c`. tmux already provides the inner terminal attributes, so the
 * outer DA reply must not be forwarded into a tmux pane.
 */
export function filterTerminalInput(kind: TerminalKind["type"] | undefined, input: string): string {
  if (kind !== "tmux-pane") return input;
  return input.replace(TMUX_DEVICE_ATTRIBUTES_REPLY, "");
}
