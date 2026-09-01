import { useCallback, useEffect, useRef } from "react";
import { writeSessionBytes } from "../services/sessionService";

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
 * Single-fire paste sender bound to a session.
 *
 * With the Rust async writer (Perf 011, see `src-tauri/.../pty.rs`), the
 * IPC handler returns within microseconds after queuing bytes into a
 * dedicated writer thread. So a single IPC call is the right shape here:
 * no rAF batching, no chunked drains, no JS-side state machine.
 */
export function usePasteBatcher(sessionId: number) {
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const enqueuePaste = useCallback((text: string) => {
    if (text.length === 0) return;
    const bytes = new TextEncoder().encode(text);
    writeSessionBytes(sessionIdRef.current, bytes);
  }, []);

  return { enqueuePaste };
}