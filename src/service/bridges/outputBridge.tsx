/**
 * Output bridge — wires Tauri `session-output` events to the
 * output-store metadata (active session id, dirty flags).
 *
 * **Skeleton in Commit 3**: just subscribes to mark the
 * `dirtySessionIds` set whenever a session-output event
 * arrives. The actual buffer writes are still consumed by
 * `infra/buffers/sessionOutputBuffer.ts` (Perf 001).
 *
 * **Render**: returns `null`. Mount once at the top of the
 * React tree.
 */
import { useEffect } from "react";
import { infraEventBus } from "../../infra/tauri/eventBus";
import { markOutputDirty } from "../output/actions";

export function OutputBridge(): null {
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      infraEventBus.subscribe<[number, number[]]>("session-output", (payload) => {
        const [sessionId] = payload;
        markOutputDirty(sessionId);
      }),
    );

    return () => {
      for (const un of unsubs) un();
    };
  }, []);

  return null;
}
