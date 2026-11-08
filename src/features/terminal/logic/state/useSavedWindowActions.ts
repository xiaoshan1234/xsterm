import { useCallback } from "react";
import type {
  PaneNode,
  SavedWindowConfig,
  Terminal,
  Window,
  Workspace,
} from "../../../../types/terminal";
import {
  createLeafPane,
  getDefaultWindowName,
  getLeafPaneIds,
  stripSessionIdFromPaneTree,
  withRecomputedSessionIds,
} from "./paneUtils";
import { getUniqueWindowName } from "./useTerminalActions.helpers";
import { createRollback } from "./usePersistenceActions.helpers";

interface UseSavedWindowActionsDeps {
  savedWindowConfigs: SavedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<SavedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
}

export function useSavedWindowActions(deps: UseSavedWindowActionsDeps) {
  const {
    savedWindowConfigs,
    workspacesRef,
    terminalsRef,
    setWorkspaces,
    setSavedWindowConfigs,
    setSessions,
    establishingSessionsRef,
    persistSavedWindowConfigs,
    openFromConfigInternal,
  } = deps;

  const saveWindow = useCallback(
    (workspaceId: string, windowId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      if (!workspace || !window) return;

      const savedWindow: SavedWindowConfig = {
        id: crypto.randomUUID(),
        name: name.trim() || window.name,
        rootPane: stripSessionIdFromPaneTree(window.rootPane),
      };

      setSavedWindowConfigs((prev) => {
        const updated = [...prev, savedWindow];
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWindowConfigs, persistSavedWindowConfigs],
  );

  const saveAllWindows = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const newConfigs: SavedWindowConfig[] = workspace.windows.map((window) => ({
        id: crypto.randomUUID(),
        name: window.name,
        rootPane: stripSessionIdFromPaneTree(window.rootPane),
      }));

      setSavedWindowConfigs((prev) => {
        const updated = [...prev, ...newConfigs];
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWindowConfigs, persistSavedWindowConfigs],
  );

  const loadWindow = useCallback(
    async (savedWindowId: string, workspaceId?: string): Promise<Window> => {
      const saved = savedWindowConfigs.find((w) => w.id === savedWindowId);
      if (!saved) throw new Error("Saved window config not found");

      const configIdToSession = new Map<string, Terminal>();

      const rollback = createRollback({
        setSessions,
        establishingSessionsRef,
        logTag: "window",
      });

      const buildTree = async (node: PaneNode): Promise<PaneNode> => {
        if (node.type === "leaf") {
          const configId = node.configId;
          if (configId) {
            let terminal = configIdToSession.get(configId);
            if (!terminal) {
              try {
                terminal = await openFromConfigInternal(configId);
                configIdToSession.set(configId, terminal);
              } catch (e) {
                console.error("Failed to recreate terminal for window:", e);
                await rollback(configIdToSession);
                throw e;
              }
            }
            return createLeafPane(node.size, terminal.id, configId);
          }
          return { ...createLeafPane(node.size), id: crypto.randomUUID() };
        }
        const children = await Promise.all((node.children ?? []).map((child) => buildTree(child)));
        return {
          id: crypto.randomUUID(),
          type: "split",
          direction: node.direction,
          size: node.size,
          children,
        };
      };

      const rootPane = await buildTree(saved.rootPane);
      const baseName = saved.name || getDefaultWindowName(rootPane, terminalsRef.current, "Window");
      const window: Window = {
        id: crypto.randomUUID(),
        name: baseName,
        rootPane,
        activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
      };

      const targetWorkspaceId = workspaceId ?? workspacesRef.current[0]?.id;
      if (!targetWorkspaceId) throw new Error("No workspace available to load window");

      setWorkspaces((prev) => {
        const uniqueName = getUniqueWindowName(prev, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace,
        );
      });
      return window;
    },
    [
      savedWindowConfigs,
      openFromConfigInternal,
      terminalsRef,
      workspacesRef,
      setSessions,
      setWorkspaces,
      establishingSessionsRef,
    ],
  );

  const deleteSavedWindow = useCallback(
    (id: string) => {
      setSavedWindowConfigs((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [setSavedWindowConfigs, persistSavedWindowConfigs],
  );

  const renameSavedWindow = useCallback(
    (id: string, name: string) => {
      setSavedWindowConfigs((prev) => {
        const updated = prev.map((w) => (w.id === id ? { ...w, name } : w));
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [setSavedWindowConfigs, persistSavedWindowConfigs],
  );

  return {
    saveWindow,
    saveAllWindows,
    loadWindow,
    deleteSavedWindow,
    renameSavedWindow,
  };
}
