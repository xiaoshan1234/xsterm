/**
 * Pure text transformations applied before paste is sent to the PTY.
 *
 * Used by the paste-confirmation dialog (PasteConfirmDialog) so the user can
 * opt-in to scrubbing line endings and expanding tabs before the payload
 * reaches the shell. All functions are total: empty input returns empty
 * output, no input ever throws.
 */

/**
 * Replace every tab character with `spacesPerTab` literal spaces.
 *
 * - `spacesPerTab <= 0` is a no-op (the caller is expected to gate this
 *   behind a checkbox, but we defend in depth).
 * - Multibyte input is preserved verbatim; only `\t` (U+0009) is touched.
 */
export function convertTabs(text: string, spacesPerTab: number): string {
  if (spacesPerTab <= 0) return text;
  if (!text.includes("\t")) return text;
  return text.replace(/\t/g, " ".repeat(spacesPerTab));
}

/**
 * Collapse any of CRLF / CR / LF into a single CR character.
 *
 * Order matters: handle CRLF first so we don't emit two CRs. The single CR is
 * a deliberate choice — it preserves the original "submit a line" semantics
 * for shell programs that ignore bracketed-paste (the common case for plain
 * bash / zsh readline). Programs that explicitly support bracketed paste will
 * still see the markers from the upstream rAF batcher.
 */
export function convertLineEndings(text: string): string {
  if (!/[\r\n]/.test(text)) return text;
  return text.replace(/\r\n|\r|\n/g, "\r");
}

/**
 * Count the number of "lines" implied by `text`.
 *
 * Definition: split on the first newline variant found (CRLF > CR > LF) and
 * return the part count. This matches the user-visible intuition that
 * `"a\nb\nc"` is 3 lines and `"a"` is 1 line.
 *
 * - Empty string → 1 (an empty paste is still one "line" from the user's POV).
 * - Trailing newline adds an extra empty part; `"a\n"` is 2 lines.
 */
export function countLines(text: string): string[] {
  if (text === "") return [""];
  // Pick the most likely separator: CRLF first, then bare CR, then LF.
  if (text.includes("\r\n")) return text.split("\r\n");
  if (text.includes("\r")) return text.split("\r");
  return text.split("\n");
}

export function countChars(text: string): number {
  return text.length;
}