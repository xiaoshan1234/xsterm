/**
 * closeWorkspace — close a workspace (the "default" workspace is
 * protected) and all of its session ids on the backend.
 *
 * TODO: legacy edge cases not ported —
 * - dispatching rollback for sessions created via in-flight
 *   `loadWorkspace` rebuilds.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";

export function closeWorkspace(workspaceId: string): void {
  const wsStore = useWorkspaceStore.getState();
  const workspace = wsStore.workspaces.find((w) => w.id === workspaceId);
  if (!workspace || workspace.name === "default") return;

  if (workspace.sessionIds.length > 0) {
    const ids = new Set(workspace.sessionIds);
    ids.forEach((sessionId) => {
      tauri.closeSession(sessionId).catch((e) => console.error("Failed to close session:", e));
      clearSessionOutput(sessionId);
    });
    useSessionStore.getState().setSessions((prev) => prev.filter((s) => !ids.has(s.id)));
  }

  wsStore.setWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
  wsStore.setActiveWorkspaceId((current) => {
    if (current !== workspaceId) return current;
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    const closedIndex = currentWorkspaces.findIndex((w) => w.id === workspaceId);
    const remaining = currentWorkspaces.filter((w) => w.id !== workspaceId);
    const fallback =
      remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1] ?? null;
    return fallback?.id ?? null;
  });
}