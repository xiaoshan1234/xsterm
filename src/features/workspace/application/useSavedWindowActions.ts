import { useCallback } from "react";
import {
  createLaunchConfigId,
  createPaneId,
  createWindowId,
  type LaunchConfigId,
  type TerminalId,
  type WindowId,
  type WorkspaceId,
} from "../../../models";
import { createApplicationError } from "../../../models/applicationError";
import type { Terminal } from "../../../features/terminal";
import type { EditablePaneNode } from "../contracts";
import type { SavedWindowConfig, Window, Workspace } from "../contracts";
import {
  createLeafPane,
  getDefaultWindowName,
  getLeafPaneIds,
  stripSessionIdFromPaneTree,
  withRecomputedSessionIds,
} from "./paneTreeOperations";
import { getUniqueWindowName } from "./windowOperations";
import { createRollback } from "./usePersistenceActions.helpers";

interface UseSavedWindowActionsDeps {
  savedWindowConfigs: SavedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<SavedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<TerminalId>>;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
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
    closeTerminal,
  } = deps;

  const saveWindow = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      if (!workspace || !window) return;

      const savedWindow: SavedWindowConfig = {
        id: createLaunchConfigId(crypto.randomUUID()),
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
    (workspaceId: WorkspaceId) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const newConfigs: SavedWindowConfig[] = workspace.windows.map((window) => ({
        id: createLaunchConfigId(crypto.randomUUID()),
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
    async (savedWindowId: LaunchConfigId, workspaceId?: WorkspaceId): Promise<Window> => {
      const saved = savedWindowConfigs.find((w) => w.id === savedWindowId);
      if (!saved) throw createApplicationError("not-found", "Saved window config not found");

      const configIdToSession = new Map<string, Terminal>();

      const rollback = createRollback({
        closeTerminal,
        setSessions,
        establishingSessionsRef,
        logTag: "window",
      });

      const buildTree = async (node: EditablePaneNode): Promise<EditablePaneNode> => {
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
          return createLeafPane(node.size);
        }
        const children = await Promise.all((node.children ?? []).map((child) => buildTree(child)));
        return {
          id: createPaneId(crypto.randomUUID()),
          type: "split",
          direction: node.direction,
          size: node.size,
          children,
        };
      };

      const rootPane = await buildTree(saved.rootPane);
      const baseName = saved.name || getDefaultWindowName(rootPane, terminalsRef.current, "Window");
      const window: Window = {
        id: createWindowId(crypto.randomUUID()),
        name: baseName,
        rootPane,
        activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
      };

      const targetWorkspaceId = workspaceId ?? workspacesRef.current[0]?.id;
      if (!targetWorkspaceId) {
        throw createApplicationError("invalid-state", "No workspace available to load window");
      }

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
      closeTerminal,
    ],
  );

  const deleteSavedWindow = useCallback(
    (id: LaunchConfigId) => {
      setSavedWindowConfigs((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [setSavedWindowConfigs, persistSavedWindowConfigs],
  );

  const renameSavedWindow = useCallback(
    (id: LaunchConfigId, name: string) => {
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
