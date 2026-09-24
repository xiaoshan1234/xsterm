/**
 * loadWindow — rebuild a single saved Window and append it to the
 * target workspace.
 *
 * TODO: legacy rollback path (close created sessions on failure) not
 * ported.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import {
  createLeafPane,
  generateId,
  getDefaultWindowName,
  getLeafPaneIds,
} from "../../app/rules/paneTree";
import { getUniqueWindowName } from "../../app/rules/sessionRules";
import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils";
import { openSavedSession } from "./openSavedSession";
import type { PaneLeafNode, PaneSplitNode, PersistedPaneNode } from "../../model/pane";
import type { Window } from "../../model/window";

export async function loadWindow(savedWindowId: string, workspaceId?: string): Promise<Window> {
  const persistenceStore = usePersistenceStore.getState();
  const saved = persistenceStore.savedWindowConfigs.find((w) => w.id === savedWindowId);
  if (!saved) throw new Error("Saved window config not found");

  const configIdToSession = new Map<string, Awaited<ReturnType<typeof openSavedSession>>>();

  const buildTree = async (node: PersistedPaneNode): Promise<PaneLeafNode | PaneSplitNode> => {
    if (node.kind === "leaf") {
      const configId = node.binding?.configId;
      if (configId) {
        let session = configIdToSession.get(configId);
        if (!session) {
          session = await openSavedSession(configId);
          configIdToSession.set(configId, session);
        }
        return createLeafPane(node.size, session.id, configId);
      }
      return createLeafPane(node.size);
    }
    const children = await Promise.all(node.layout.children.map((child) => buildTree(child)));
    const split: PaneSplitNode = {
      id: generateId(),
      kind: "split",
      size: node.size,
      layout: { direction: node.layout.direction, children },
    };
    return split;
  };

  const rootPane = await buildTree(saved.rootPane);
  const baseName = saved.name || getDefaultWindowName(rootPane, [], "Window");
  const window: Window = {
    id: generateId(),
    name: baseName,
    kind: "terminal",
    rootPane,
    activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
  };

  const wsStore = useWorkspaceStore.getState();
  const targetWorkspaceId = workspaceId ?? wsStore.workspaces[0]?.id;
  if (!targetWorkspaceId) throw new Error("No workspace available to load window");

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) =>
      workspace.id === targetWorkspaceId
        ? withRecomputedSessionIds({
            ...workspace,
            windows: [
              ...workspace.windows,
              { ...window, name: getUniqueWindowName(prev, targetWorkspaceId, baseName) },
            ],
            activeWindowId: window.id,
          })
        : workspace,
    ),
  );
  return window;
}
