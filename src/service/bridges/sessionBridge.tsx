/**
 * Session bridge — Phase 3 (rewritten).
 *
 * **Before Phase 3**: subscribed directly to `infraEventBus`'s
 * `session-closed` / `session-disconnected` events and mutated
 * `useSessionStore` from the handler. Cross-service fan-out
 * (workspace pane-tree cleanup) lived inside the same handler.
 *
 * **Phase 3**: the model owns the `onClosed` / `onDisconnected`
 * subscriptions (see `model/session/model.ts::createSessionModel`).
 * This bridge observes model state via `model.subscribe()` and runs
 * the cross-service fan-out — workspace pane-tree cleanup — whenever
 * a session disappears from the registry.
 *
 * The model is received as a prop rather than constructed here so
 * the host (`App.tsx`) is the single owner of the model lifecycle.
 * `useSessionModel()` in `App.tsx` is the only `createSessionModel`
 * call site in production.
 */
import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../workspace/store";
import { findPaneNode, getLeafPaneIds, removeSessionAndCollapse } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils";
import type { SessionModel } from "../../model/session/model";
import type { Session } from "../../model/session/types";

interface SessionBridgeProps {
  /**
   * The `SessionModel` instance — typically obtained via
   * `useSessionModel()` in `App.tsx`. Required.
   */
  model: SessionModel;
}

/**
 * Mount once at the top of the React tree. Returns `null`.
 *
 * Behaviour:
 * - Subscribes to model changes via `model.subscribe()`.
 * - Diffs the previous session list against the new one: any id that
 *   disappeared triggers a workspace-pane-tree cleanup.
 * - Cleanup walks every workspace's terminal windows, drops the
 *   matching leaf, collapses empty splits, recomputes `activePaneId`,
 *   and persists the new tree via `withRecomputedSessionIds`.
 *
 * **Note**: we observe via `model.subscribe()` rather than directly
 * via `bus.onClosed` to keep the bus subscription surface inside the
 * model. The diffing is O(N + M) per change, where N = previous
 * session count, M = new session count — cheap for the expected
 * session-count range (1–20).
 */
export function SessionBridge({ model }: SessionBridgeProps): null {
  // Snapshot of the previous session id set, used to detect removed
  // sessions across model notifications. Stored in a ref so the
  // subscription handler always reads the latest snapshot without
  // re-binding on every render.
  const prevIdsRef = useRef<Set<number>>(new Set(model.list().map((s) => s.id)));

  useEffect(() => {
    // Re-prime the ref on (re-)mount so the first diff doesn't
    // trigger cleanup for sessions that existed before the bridge
    // mounted.
    prevIdsRef.current = new Set(model.list().map((s) => s.id));

    const off = model.subscribe(() => {
      const nextIds = new Set(model.list().map((s: Session) => s.id));
      const prevIds = prevIdsRef.current;
      const removed: number[] = [];
      for (const id of prevIds) {
        if (!nextIds.has(id)) removed.push(id);
      }
      prevIdsRef.current = nextIds;
      if (removed.length === 0) return;
      runWorkspaceCleanupForSessions(removed);
    });

    return () => {
      off();
    };
  }, [model]);

  return null;
}

/**
 * Walk every workspace's terminal windows, drop every leaf whose
 * `sessionId` is in `sessionIds`, collapse empty splits, recompute
 * `activePaneId`, and persist via `withRecomputedSessionIds`.
 *
 * Exported so the host (`App.tsx`) can wire it as
 * `useSessionModel({ onSessionClosed })` directly without rendering
 * this bridge — useful for headless tests.
 */
export function runWorkspaceCleanupForSessions(sessionIds: number[]): void {
  if (sessionIds.length === 0) return;
  const { setWorkspaces } = useWorkspaceStore.getState();
  setWorkspaces((prev) =>
    prev.map((workspace) =>
      withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) => {
          if (window.kind !== "terminal") return window;
          let root = window.rootPane;
          for (const sessionId of sessionIds) {
            root = removeSessionAndCollapse(root, sessionId);
          }
          const newActivePaneId = findPaneNode(root, window.activePaneId ?? "")
            ? window.activePaneId
            : (getLeafPaneIds(root)[0] ?? null);
          return { ...window, rootPane: root, activePaneId: newActivePaneId };
        }),
      }),
    ),
  );
}
