import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type SavedWindowConfig,
  type SavedWorkspace,
  type Workspace,
} from "../../../models/runtime/terminal";

export interface WorkspaceState {
  workspaces: Workspace[];
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  workspacesRef: MutableRefObject<Workspace[]>;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<string | null>>;
  savedWorkspaces: SavedWorkspace[];
  setSavedWorkspaces: Dispatch<SetStateAction<SavedWorkspace[]>>;
  savedWindowConfigs: SavedWindowConfig[];
  setSavedWindowConfigs: Dispatch<SetStateAction<SavedWindowConfig[]>>;
}

export function useWorkspaceState(): WorkspaceState {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
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
