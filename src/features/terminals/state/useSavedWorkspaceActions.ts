import { useCallback } from "react";
import type {
  PaneNode,
  SavedWorkspace,
  Terminal,
  Window,
  Workspace,
} from "../../../types/terminal";
import {
  collectSessionIdsFromWorkspace,
  createLeafPane,
  getLeafPaneIds,
  stripSessionIdFromPaneTree,
} from "./paneUtils";
import { createRollback } from "./usePersistenceActions.helpers";

interface UseSavedWorkspaceActionsDeps {
  savedWorkspaces: SavedWorkspace[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<SavedWorkspace[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
}

export function useSavedWorkspaceActions(deps: UseSavedWorkspaceActionsDeps) {
  const {
    savedWorkspaces,
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSavedWorkspaces,
    setSessions,
    establishingSessionsRef,
    persistSavedWorkspaces,
    openFromConfigInternal,
  } = deps;

  /**
   * Save a workspace as a snapshot (persisted to terminals.json)
   *
   * Workspace save flow:
   * 1. Find the target workspace (deep copy the rootPane structure, including all pane and terminal configId references)
   * 2. Generate a new savedWorkspace object (with a new ID, independent from the original workspace)
   * 3. Append to savedWorkspaces and write to terminals.json via persistSavedWorkspaces
   *
   * Note: configId is saved instead of terminal ID; terminals are reconstructed via loadWorkspace after restart
   */
  const saveWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const finalName = name.trim() || workspace.name;
      const isDefault = workspace.name === "default";

      if (finalName === "default") {
        throw new Error("Workspace name is reserved");
      }

      const buildSavedWorkspace = (id: string): SavedWorkspace => ({
        id,
        name: finalName,
        windows: workspace.windows.map((window) => ({
          id: crypto.randomUUID(),
          name: window.name,
          rootPane: stripSessionIdFromPaneTree(window.rootPane),
        })),
      });

      if (isDefault) {
        if (savedWorkspaces.some((w) => w.name.trim() === finalName)) {
          throw new Error("Workspace name already exists");
        }
        const savedWorkspaceData = buildSavedWorkspace(crypto.randomUUID());
        setSavedWorkspaces((prev) => {
          const updated = [...prev, savedWorkspaceData];
          persistSavedWorkspaces(updated);
          return updated;
        });
        return;
      }

      const existingSavedByName = savedWorkspaces.find((w) => w.name.trim() === finalName);
      const savedWorkspaceData = buildSavedWorkspace(
        existingSavedByName?.id ?? crypto.randomUUID(),
      );

      if (existingSavedByName) {
        setSavedWorkspaces((prev) => {
          const updated = prev.map((w) =>
            w.id === existingSavedByName.id ? savedWorkspaceData : w,
          );
          persistSavedWorkspaces(updated);
          return updated;
        });
      } else {
        setSavedWorkspaces((prev) => {
          const updated = [...prev, savedWorkspaceData];
          persistSavedWorkspaces(updated);
          return updated;
        });
      }
    },
    [workspacesRef, setSavedWorkspaces, persistSavedWorkspaces, savedWorkspaces],
  );

  /**
   * Load a workspace from a snapshot (restored from terminals.json)
   *
   * Full workspace load flow:
   * 1. Find savedWorkspace, traverse the pane tree (buildTree recursion)
   * 2. For each leaf pane: if it contains a configId, call openFromConfigInternal to reconstruct the terminal (reuse existing terminals to avoid duplicates)
   * 3. buildTree returns a new pane tree (all node IDs regenerated, independent from the original snapshot)
   * 4. Create the workspace, add to workspaces, set as active
   *
   * Exception handling: if any pane reconstruction fails, rollback (close created terminals, revert terminals state)
   */
  const loadWorkspace = useCallback(
    async (savedWorkspaceId: string): Promise<Workspace> => {
      const saved = savedWorkspaces.find((w) => w.id === savedWorkspaceId);
      if (!saved) throw new Error("Saved workspace not found");

      const configIdToSession = new Map<string, Terminal>();

      const rollback = createRollback({
        setSessions,
        establishingSessionsRef,
        logTag: "workspace",
      });

      const buildTree = async (node: PaneNode, depth = 0): Promise<PaneNode> => {
        if (node.type === "leaf") {
          if (node.terminalId !== undefined && node.configId === undefined) {
            console.warn(
              `[loadWorkspace] leaf has terminalId but no configId; terminal cannot be recreated`,
            );
          }
          const configId = node.configId;
          if (configId) {
            let terminal = configIdToSession.get(configId);
            if (!terminal) {
              try {
                terminal = await openFromConfigInternal(configId);
                configIdToSession.set(configId, terminal);
              } catch (e) {
                console.error("Failed to recreate terminal for workspace:", e);
                await rollback(configIdToSession);
                throw e;
              }
            }
            return createLeafPane(node.size, terminal.id, configId);
          }
          return { ...createLeafPane(node.size), id: crypto.randomUUID() };
        }
        const children = await Promise.all(
          (node.children ?? []).map((child) => buildTree(child, depth + 1)),
        );
        return {
          id: crypto.randomUUID(),
          type: "split",
          direction: node.direction,
          size: node.size,
          children,
        };
      };

      const buildWindow = async (savedWindow: {
        id: string;
        name: string;
        rootPane: PaneNode;
      }): Promise<Window> => {
        const rootPane = await buildTree(savedWindow.rootPane);
        return {
          id: crypto.randomUUID(),
          name: savedWindow.name,
          rootPane,
          activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
        };
      };

      const builtWindows = await Promise.all(saved.windows.map((w) => buildWindow(w)));
      const usedNames = new Set<string>();
      const windows = builtWindows.map((w) => {
        if (!usedNames.has(w.name)) {
          usedNames.add(w.name);
          return w;
        }
        let suffix = 2;
        while (usedNames.has(`${w.name}-${suffix}`)) {
          suffix += 1;
        }
        const unique = `${w.name}-${suffix}`;
        usedNames.add(unique);
        return { ...w, name: unique };
      });
      const activeWindow = windows[0] ?? null;
      const workspaceWithoutIds: Workspace = {
        id: crypto.randomUUID(),
        name: saved.name,
        windows,
        activeWindowId: activeWindow?.id ?? null,
        terminalIds: [],
        savedWorkspaceId: saved.id,
      };
      const workspace: Workspace = {
        ...workspaceWithoutIds,
        terminalIds: collectSessionIdsFromWorkspace(workspaceWithoutIds),
      };

      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [
      savedWorkspaces,
      openFromConfigInternal,
      setSessions,
      setWorkspaces,
      setActiveWorkspaceId,
      establishingSessionsRef,
    ],
  );

  const deleteSavedWorkspace = useCallback(
    (id: string) => {
      setSavedWorkspaces((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [setSavedWorkspaces, persistSavedWorkspaces],
  );

  const renameSavedWorkspace = useCallback(
    (id: string, name: string) => {
      const trimmedName = name.trim();
      if (trimmedName === "default") {
        throw new Error("Workspace name is reserved");
      }
      if (savedWorkspaces.some((w) => w.id !== id && w.name.trim() === trimmedName)) {
        throw new Error("Workspace name already exists");
      }

      setSavedWorkspaces((prev) => {
        const updated = prev.map((w) => (w.id === id ? { ...w, name: trimmedName } : w));
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [setSavedWorkspaces, persistSavedWorkspaces, savedWorkspaces],
  );

  return {
    saveWorkspace,
    loadWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  };
}
