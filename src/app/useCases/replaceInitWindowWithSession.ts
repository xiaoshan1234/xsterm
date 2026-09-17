/**
 * replaceInitWindowWithSession — promote an init placeholder Window
 * to a real terminal window bound to a session.
 */
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "../../app/rules/sessionRules";
import { createLeafPane } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../app/rules/workspaceRules";

export function replaceInitWindowWithSession(
  workspaceId: string,
  windowId: string,
  sessionId: number,
  configId: string,
  name?: string,
): void {
  const wsStore = useWorkspaceStore.getState();
  assertSessionNotUsedElsewhere(wsStore.workspaces, workspaceId, windowId, sessionId);

  const rootPane = createLeafPane(100, sessionId, configId);
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  const baseName = name ?? session?.name ?? "Window";

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      return withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) =>
          window.id === windowId
            ? {
                ...window,
                name: getUniqueWindowName(prev, workspaceId, baseName, windowId),
                rootPane,
                activePaneId: rootPane.id,
                windowType: "terminal",
              }
            : window,
        ),
      });
    }),
  );
}
