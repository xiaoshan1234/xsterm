/**
 * Session bridge — wires Tauri `session-closed` and `session-disconnected`
 * events to the service stores.
 *
 * **`session-output`**: handled elsewhere. `OutputBridge` subscribes to
 * the same `infraEventBus` event and calls `markOutputDirty` on the
 * output store. The infra `sessionOutputChannel` dispatches the raw
 * bytes to per-session Terminal subscribers. The `Session` model has
 * no raw-bytes field, so this bridge intentionally does not subscribe
 * to `session-output` to avoid duplicating the work.
 *
 * **`session-closed` / `session-disconnected`**: previously handled by
 * the legacy `useTauriListeners` hook. Migrated here because both
 * bridges subscribe via `infraEventBus`, and the legacy hook has no
 * reason to keep its own duplicate subscription.
 *
 * **Render**: returns `null`. Mount this component once at the top of
 * the React tree (`App.tsx`).
 */
import { useEffect } from "react";
import { infraEventBus } from "../../infra/tauri/eventBus";
import { useSessionStore } from "../session/store";
import { useWorkspaceStore } from "../workspace/store";
import { findPaneNode, getLeafPaneIds, removeSessionAndCollapse } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils";

export function SessionBridge(): null {
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      infraEventBus.subscribe<number>("session-disconnected", (sessionId) => {
        const { markSessionConnected } = useSessionStore.getState();
        markSessionConnected(sessionId, false);
      }),
    );

    unsubs.push(
      infraEventBus.subscribe<number>("session-closed", (sessionId) => {
        const { removeSession } = useSessionStore.getState();
        const { setWorkspaces } = useWorkspaceStore.getState();
        removeSession(sessionId);
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                if (window.kind !== "terminal") return window;
                const newRoot = removeSessionAndCollapse(window.rootPane, sessionId);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            }),
          ),
        );
      }),
    );

    return () => {
      for (const un of unsubs) un();
    };
  }, []);

  return null;
}
