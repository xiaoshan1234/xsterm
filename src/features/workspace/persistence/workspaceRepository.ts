import type { SavedWindowConfig, SavedWorkspace } from "../contracts";
import {
  loadSavedWindowConfigsStrict,
  loadSavedWorkspacesStrict,
  persistWindowConfigsStrict,
  persistWorkspacesStrict,
} from "./workspaceStorage";

export interface WorkspaceRepository {
  loadWindowConfigs: () => Promise<SavedWindowConfig[]>;
  loadWorkspaces: () => Promise<SavedWorkspace[]>;
  persistWindowConfigs: (configs: SavedWindowConfig[]) => Promise<void>;
  persistWorkspaces: (workspaces: SavedWorkspace[]) => Promise<void>;
}

export const workspaceRepository: WorkspaceRepository = {
  loadWindowConfigs: loadSavedWindowConfigsStrict,
  loadWorkspaces: loadSavedWorkspacesStrict,
  persistWindowConfigs: persistWindowConfigsStrict,
  persistWorkspaces: persistWorkspacesStrict,
};
