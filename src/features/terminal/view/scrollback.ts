/**
 * Normalize tmux `capture-pane` output for xterm.
 *
 * tmux returns pane rows as control-mode reply lines; joining them with `\n`
 * yields bare line feeds. xterm is created with `convertEol: false` (its
 * default), so a bare `\n` only moves the cursor down and leaves it at the
 * current column, producing the diagonal/staircase prompt effect when
 * scrollback is replayed. Convert every line ending to CRLF so each captured
 * row starts at column 0.
 */
export function normalizeCapturedScrollback(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}
