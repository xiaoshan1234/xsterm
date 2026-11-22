import { type Terminal as XTerm } from "@xterm/xterm";

/** Upper bound on synthetic wheel ticks before we give up finding the prompt. */
export const MAX_PROMPT_JUMP_STEPS = 80;

export interface PromptJumpLine {
  translateToString(trimRight?: boolean): string;
}

export interface PromptJumpBuffer {
  type: "normal" | "alternate";
  baseY: number;
  cursorY: number;
  length: number;
  getLine(y: number): PromptJumpLine | undefined;
}

export type PromptJumpTerminal = { buffer: { active: PromptJumpBuffer } };

/**
 * Reads the content of the line the TUI cursor is on. In alternate-screen TUIs
 * this is the best proxy we have for "the input line", and it is refreshed on
 * every render so the fingerprint tracks what the user is typing.
 */
export function readPromptFingerprint(term: PromptJumpTerminal): string {
  const buffer = term.buffer.active;
  if (buffer.type !== "alternate") return "";
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  return line?.translateToString(true) ?? "";
}

/**
 * True when any visible line equals the fingerprint (trailing whitespace
 * ignored). A single-line match is intentionally exact rather than `includes`
 * to avoid matching random lines that merely contain the same words.
 */
export function screenContainsLine(term: PromptJumpTerminal, fingerprint: string): boolean {
  const buffer = term.buffer.active;
  const needle = fingerprint.trimEnd();
  if (!needle) return false;
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (line && line.translateToString(true).trimEnd() === needle) return true;
  }
  return false;
}

/** Cheap whole-screen signature used to detect "scrolling no longer changes". */
export function screenSignature(term: PromptJumpTerminal): string {
  const buffer = term.buffer.active;
  const rows: string[] = [];
  for (let row = 0; row < buffer.length; row++) {
    rows.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  return rows.join("\n");
}

/**
 * Encodes a synthetic mouse-wheel-down event using xterm's SGR mouse protocol
 * (`?1006`). Returns the escape sequence bytes the PTY expects. This is the
 * only encoding we emit; apps using legacy encodings are a best-effort no-op.
 */
export function encodeWheelDownSequence(col: number, row: number): string {
  return `\x1b[<65;${col};${row}M`;
}

/** Resolves on the next xterm render, with a safety timeout so we never hang. */
export function waitForNextRender(term: XTerm, timeoutMs = 160): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      disposable.dispose();
      clearTimeout(timer);
      resolve();
    };
    const disposable = term.onRender(finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}
