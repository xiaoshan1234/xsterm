import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { WorkspaceId } from "../../../models";
import type { SavedWindowConfig, SavedWorkspace, Workspace } from "../contracts";

export interface WorkspaceState {
  workspaces: Workspace[];
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  workspacesRef: MutableRefObject<Workspace[]>;
  activeWorkspaceId: WorkspaceId | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<WorkspaceId | null>>;
  savedWorkspaces: SavedWorkspace[];
  setSavedWorkspaces: Dispatch<SetStateAction<SavedWorkspace[]>>;
  savedWindowConfigs: SavedWindowConfig[];
  setSavedWindowConfigs: Dispatch<SetStateAction<SavedWindowConfig[]>>;
}

export function useWorkspaceState(): WorkspaceState {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<WorkspaceId | null>(null);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [savedWindowConfigs, setSavedWindowConfigs] = useState<SavedWindowConfig[]>([]);
  const workspacesRef = useRef(workspaces);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const syncActiveWorkspace = useCallback(
    (nextWorkspaces: Workspace[]) => {
      setActiveWorkspaceId((current) => {
        if (current === null) {
          return nextWorkspaces[0]?.id ?? null;
        }
        return nextWorkspaces.some((workspace) => workspace.id === current)
          ? current
          : (nextWorkspaces[0]?.id ?? null);
      });
    },
    [setActiveWorkspaceId],
  );

  useEffect(() => {
    syncActiveWorkspace(workspaces);
  }, [syncActiveWorkspace, workspaces]);

  return {
    workspaces,
    setWorkspaces,
    workspacesRef,
    activeWorkspaceId,
    setActiveWorkspaceId,
    savedWorkspaces,
    setSavedWorkspaces,
    savedWindowConfigs,
    setSavedWindowConfigs,
  };
}
