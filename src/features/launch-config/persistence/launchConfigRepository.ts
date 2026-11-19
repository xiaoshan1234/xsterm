import type { SavedTerminalConfig, TerminalGroup } from "../contracts";
import {
  loadSavedConfigs,
  loadSavedGroups,
  persistConfigs,
  persistGroups,
  type LaunchConfigGroupStore,
} from "./launchConfigStorage";

export interface LaunchConfigRepository {
  loadConfigs: () => Promise<SavedTerminalConfig[]>;
  loadGroups: () => Promise<LaunchConfigGroupStore>;
  persistConfigs: (configs: SavedTerminalConfig[]) => Promise<void>;
  persistGroups: (groups: { groups: TerminalGroup[]; nextGroupId: number }) => Promise<void>;
}

export const launchConfigRepository: LaunchConfigRepository = {
  loadConfigs: loadSavedConfigs,
  loadGroups: loadSavedGroups,
  persistConfigs,
  persistGroups,
};
