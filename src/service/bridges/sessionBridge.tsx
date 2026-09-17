/**
 * Session bridge — wires Tauri `session-output`, `session-closed`,
 * and `session-disconnected` events to the session store.
 *
 * **Skeleton in Commit 3**: subscribes to the event bus and
 * exercises the listener wiring. The actual store mutations
 * are wired in Commit 4 (where the listener bodies can reach
 * across to `service/tmux/store.ts` and friends without
 * breaking the no-cross-service-import rule inside this file).
 *
 * **Render**: returns `null`. Mount this component once at the
 * top of the React tree (`App.tsx`).
 */
import { useEffect } from "react";
import { infraEventBus } from "../../infra/tauri/eventBus";

export function SessionBridge(): null {
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // session-output: currently the buffers (infra/buffers) consume
    // this; the bridge here just acknowledges the wiring so a
    // future Commit-4 mutation has a stable subscription point.
    unsubs.push(
      infraEventBus.subscribe<[number, number[]]>("session-output", () => {
        // no-op in Commit 3 — see infra/buffers/sessionOutputBuffer.ts
      }),
    );

    unsubs.push(
      infraEventBus.subscribe<number>("session-closed", () => {
        // no-op in Commit 3; Commit 4 will drop the session row
      }),
    );

    unsubs.push(
      infraEventBus.subscribe<number>("session-disconnected", () => {
        // no-op in Commit 3; Commit 4 will flip isConnected=false
      }),
    );

    return () => {
      for (const un of unsubs) un();
    };
  }, []);

  return null;
}
