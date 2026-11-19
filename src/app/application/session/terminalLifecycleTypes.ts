import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TerminalId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { SavedTerminalConfig, TerminalGroup } from "../../../features/launch-config";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Window, Workspace } from "../../../features/workspace";

export interface UseSessionLifecycleDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: MutableRefObject<Terminal[]>;
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  activeWorkspaceId: WorkspaceId | null;
  establishingSessionsRef: MutableRefObject<Set<TerminalId>>;
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
  ) => Window;
  tmuxControllerConfigsRef?: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef?: MutableRefObject<Map<number, string>>;
  syncOpenTmuxSessions: () => void;
  pendingTmuxSessionKeysRef: MutableRefObject<Set<string>>;
  tmuxControllersClosingRef?: MutableRefObject<Set<number>>;
}
