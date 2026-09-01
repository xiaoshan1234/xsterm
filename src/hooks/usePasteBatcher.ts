import { useCallback, useEffect, useRef } from "react";
import { writeSessionBytes } from "../services/sessionService";
import { convertLineEndings } from "../utils/textTransform";

/**
 * Bracketed-paste mode wrap markers. Sent to the PTY before / after a paste
 * payload when the receiving program (vim, fzf, less, …) has opted in via
 * DEC private mode 2004. xterm.js tracks that opt-in state internally
 * (`terminal.modes.bracketedPasteMode`); we read it from the terminal in
 * `Terminal.tsx` and pass it to `enqueuePaste`.
 */
export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";

/**
 * Split a UTF-8 byte buffer into chunks of at most `chunkSize` bytes, never
 * splitting a multi-byte codepoint. Pure function so it can be unit-tested
 * without React.
 *
 * Algorithm: for each window, if the byte at the proposed cut is a
 * continuation byte (`10xxxxxx`), back up to the start of its codepoint. If
 * the window would land *inside* a codepoint from the start (rare — happens
 * when the chunk size is smaller than the leading codepoint), extend the
 * window forward to include the whole codepoint so no data is lost.
 */
export function chunkBytes(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  if (bytes.length === 0) return [];
  if (chunkSize <= 0) throw new Error("chunkSize must be positive");

  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + chunkSize, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    if (end === offset) {
      let codepointEnd = offset + 1;
      while (codepointEnd < bytes.length && (bytes[codepointEnd] & 0xc0) === 0x80) {
        codepointEnd++;
      }
      end = codepointEnd;
    }
    chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * Format paste text for the PTY, optionally wrapping it in bracketed-paste
 * markers when the receiving program has opted in.
 *
 * Mirrors the oxideterm `formatTerminalPasteInput` contract: line endings
 * are always normalized to `\r` first (so plain `\n` / `\r\n` become the
 * CR that line disciplines / readline expect), and the ESC markers are
 * only emitted when:
 *   - the user / TUI has set bracketed-paste mode on the terminal, AND
 *   - the resulting payload still contains a `\r` (i.e. it has a newline).
 * A paste that contains no newlines never needs the wrap — it's
 * indistinguishable from typed input.
 */
export function formatPasteForBracketedMode(
  text: string,
  bracketedPasteMode: boolean,
): string {
  const normalized = convertLineEndings(text);
  if (!bracketedPasteMode || !normalized.includes("\r")) {
    return normalized;
  }
  return `${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}`;
}

/**
 * Append a fire-and-forget async operation to a serialized Promise queue,
 * preserving call order and isolating rejections.
 *
 * Extracted as a pure helper so the queue semantics can be unit-tested
 * without React or a Tauri runtime. `queueRef.current` is rewritten to a
 * new Promise that resolves after `fn()` completes; future appends chain
 * onto the rewritten ref. The `.catch(() => {})` swallows upstream
 * rejections so one failing op doesn't poison every subsequent append.
 */
export function appendToPasteQueue(
  queueRef: { current: Promise<unknown> },
  fn: () => Promise<unknown>,
): void {
  queueRef.current = queueRef.current.catch(() => {}).then(fn);
}

/**
 * Single-fire paste sender bound to a session.
 *
 * With the Rust async writer (Perf 011, see `src-tauri/.../pty.rs`), the
 * IPC handler returns within microseconds after queuing bytes into a
 * dedicated writer thread. So a single IPC call is the right shape here:
 * no rAF batching, no chunked drains, no JS-side state machine.
 *
 * `bracketedPasteMode` is read from `terminal.modes.bracketedPasteMode` at
 * the call site (`Terminal.tsx`) and forwarded here. xterm.js tracks the
 * DEC private mode 2004 state automatically when the running program sends
 * `\x1b[?2004h` / `\x1b[?2004l`, so we don't need to parse it ourselves.
 *
 * **Ordering guarantee** (mirrors oxideterm's `encodedInputQueueRef`):
 * every `enqueuePaste` call appends to `inputQueueRef.current` instead of
 * firing a bare `invoke()`. This makes the **order** of concurrent pastes
 * a JS-side contract: even if the React event loop schedules two calls in
 * the same microtask (e.g. a paste event immediately followed by a typed
 * keystroke that gets forwarded through the same batcher in a future
 * change), each new call is chained onto the previous Promise, so the
 * IPC `invoke()` is dispatched only after the prior one is awaited.
 *
 * Tauri's IPC queue + Rust's `SyncSender` already preserve arrival order
 * on their own; this Promise chain makes the order explicit at the JS
 * layer and survives future changes (e.g. introducing async encoding for
 * non-UTF-8 terminals).
 */
export function usePasteBatcher(sessionId: number) {
  const sessionIdRef = useRef(sessionId);
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const enqueuePaste = useCallback(
    (text: string, bracketedPasteMode: boolean) => {
      if (text.length === 0) return;
      const wrapped = formatPasteForBracketedMode(text, bracketedPasteMode);
      const bytes = new TextEncoder().encode(wrapped);

      // Append to the queue. `.catch(() => {})` isolates failures so one
      // rejection doesn't poison every subsequent paste.
      appendToPasteQueue(inputQueueRef, () =>
        writeSessionBytes(sessionIdRef.current, bytes),
      );
    },
    [],
  );

  // On unmount, do NOT cancel the queue — pending bytes should still reach
  // the PTY. If the component remounts with the same sessionId the queue
  // is gone anyway (ref doesn't survive unmount), so this is the right
  // default: best-effort flush, no abort.
  useEffect(() => undefined, []);

  return { enqueuePaste };
}