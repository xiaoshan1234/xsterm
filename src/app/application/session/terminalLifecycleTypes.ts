import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Terminal } from "../../../models/runtime/config";
import type { SavedTerminalConfig, TerminalGroup } from "../../../models/runtime/savedConfig";
import type { TmuxSessionConfig } from "../../../models/runtime/tmux";
import type { Window, Workspace } from "../../../models/workspace/EditableWorkspace";

export interface UseSessionLifecycleDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: MutableRefObject<Terminal[]>;
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  activeWorkspaceId: string | null;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
  tmuxControllerConfigsRef?: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef?: MutableRefObject<Map<number, string>>;
  syncOpenTmuxSessions: () => void;
  pendingTmuxSessionKeysRef: MutableRefObject<Set<string>>;
  tmuxControllersClosingRef?: MutableRefObject<Set<number>>;
}
