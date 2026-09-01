import { useCallback, useEffect, useRef } from "react";
import { writeSessionBytes } from "../services/sessionService";

const CHUNK_BYTES = 4096;

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
    // Back up off any continuation bytes at the cut.
    while (end > offset && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    if (end === offset) {
      // The codepoint starting at `offset` is longer than `chunkSize`. Emit
      // the whole codepoint as an oversized chunk — never split it, never
      // include stray continuation bytes in adjacent chunks.
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
 * Stateful paste chunker for a single terminal session.
 *
 * Why a hook instead of a one-shot utility: the same Terminal component mounts
 * and unmounts as panes split and merge; the rAF id and pending-chunk index
 * must survive across `enqueuePaste` calls within one mount, but reset
 * cleanly on unmount or sessionId change so we never route leftover bytes
 * to a stale session.
 *
 * Design (see doc/maintenance/perf.md Perf 010):
 *  1. `enqueuePaste(text)` runs once per paste event. The caller (the
 *     paste-confirmation dialog) has already applied any user-selected
 *     transformations, so the input here is the final string to send.
 *  2. TextEncoder runs exactly once (the bottleneck for large pastes).
 *  3. The byte array is sliced at UTF-8-safe boundaries — never split a
 *     multi-byte codepoint.
 *  4. One chunk per `requestAnimationFrame` fires `writeSessionBytes`, which
 *     itself is fire-and-forget. This spreads the IPC + Rust write_all cost
 *     over many frames instead of one huge blocking call.
 *  5. A new paste cancels any in-flight one — no two pastes share frames,
 *     so the order of bytes reaching the PTY is deterministic.
 *  6. Cleanup cancels the pending rAF and flushes any unwritten chunks
 *     synchronously so a sessionId change or unmount cannot drop input.
 */
export function usePasteBatcher(sessionId: number, chunkSize: number = CHUNK_BYTES) {
  const sessionIdRef = useRef(sessionId);
  const rafIdRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<Uint8Array[]>([]);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendNextChunk = useCallback(() => {
    rafIdRef.current = null;
    const chunks = pendingChunksRef.current;
    const idx = currentIndexRef.current;
    if (idx >= chunks.length) return;
    writeSessionBytes(sessionIdRef.current, chunks[idx]);
    currentIndexRef.current = idx + 1;
    if (currentIndexRef.current < chunks.length) {
      rafIdRef.current = requestAnimationFrame(sendNextChunk);
    }
  }, []);

  const flushNow = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const chunks = pendingChunksRef.current;
    const idx = currentIndexRef.current;
    for (let i = idx; i < chunks.length; i++) {
      writeSessionBytes(sessionIdRef.current, chunks[i]);
    }
    pendingChunksRef.current = [];
    currentIndexRef.current = 0;
  }, []);

  const enqueuePaste = useCallback(
    (text: string) => {
      if (text.length === 0) return;
      const bytes = new TextEncoder().encode(text);
      const chunks = chunkBytes(bytes, chunkSize);
      if (chunks.length === 0) return;

      // A previous paste is still mid-flight — cancel it so the new paste's
      // first chunk is what the user sees next, not a leftover from before.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      pendingChunksRef.current = chunks;
      currentIndexRef.current = 0;
      writeSessionBytes(sessionIdRef.current, chunks[0]);
      if (chunks.length > 1) {
        currentIndexRef.current = 1;
        rafIdRef.current = requestAnimationFrame(sendNextChunk);
      }
    },
    [chunkSize, sendNextChunk],
  );

  useEffect(() => {
    return () => {
      flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { enqueuePaste };
}