/**
 * loadWorkspace — rebuild a workspace from a `PersistedWorkspace` snapshot.
 * For each leaf with a `configId`, calls `openFromConfigInternal` to
 * recreate the underlying backend session.
 *
 * TODO: legacy rollback path (close created sessions on failure) not
 * ported — the snapshot rebuild is best-effort for now.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { createLeafPane, generateId, getLeafPaneIds } from "../../app/rules/paneTree";
import { openSavedSession } from "./openSavedSession";
import { collectSessionIdsFromWorkspace } from "../../app/rules/workspaceRules";
import type { PaneLeafNode, PaneSplitNode, PersistedPaneNode } from "../../model/pane";
import type { TerminalWindow } from "../../model/window";
import type { Workspace } from "../../model";

export async function loadWorkspace(savedWorkspaceId: string): Promise<Workspace> {
  const persistenceStore = usePersistenceStore.getState();
  const saved = persistenceStore.savedWorkspaces.find((w) => w.id === savedWorkspaceId);
  if (!saved) throw new Error("Saved workspace not found");

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

  const builtWindows = await Promise.all(
    saved.windows.map(async (savedWindow) => {
      const rootPane = await buildTree(savedWindow.rootPane);
      const window: TerminalWindow = {
        id: generateId(),
        name: savedWindow.name,
        kind: "terminal",
        rootPane,
        activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
      };
      return window;
    }),
  );

  // Disambiguate names
  const usedNames = new Set<string>();
  const windows = builtWindows.map((w) => {
    if (!usedNames.has(w.name)) {
      usedNames.add(w.name);
      return w;
    }
    let suffix = 2;
    while (usedNames.has(`${w.name}-${suffix}`)) suffix += 1;
    const unique = `${w.name}-${suffix}`;
    usedNames.add(unique);
    return { ...w, name: unique };
  });

  const partial: Workspace = {
    id: generateId(),
    name: saved.name,
    windows,
    activeWindowId: windows[0]?.id ?? null,
    savedWorkspaceId: saved.id,
  };
  const workspace: Workspace = {
    ...partial,
    sessionIds: collectSessionIdsFromWorkspace(partial),
  };

  const wsStore = useWorkspaceStore.getState();
  wsStore.addWorkspace(workspace);
  wsStore.setActiveWorkspace(workspace.id);
  useSessionStore.getState();
  return workspace;
}
