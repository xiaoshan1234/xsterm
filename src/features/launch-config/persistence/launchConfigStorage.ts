import { getJsonStore } from "../../../infra/storage";
import { frontendLogger as logger } from "../../../infra";
import type { LocalTerminalConfig, SshConfig } from "../contracts";
import type { SavedTerminalConfig, TerminalGroup } from "../contracts";
import type { TmuxSessionConfig } from "../contracts";

export interface LaunchConfigGroupStore {
  groups: TerminalGroup[];
  nextGroupId: number;
}

const launchConfigStore = getJsonStore("terminals.json");

/**
 * Schema versions of the `SavedTerminalConfig` on-disk format.
 * - v0 (legacy): `{type, localConfig|sshConfig, id, name, displayConfig?}`
 * - v1 (current): `{type, config, version, id, name, displayConfig?}`
 */
export const SAVED_SESSION_CONFIG_VERSION = 1;

/**
 * Migrate a raw entry read from the persisted JSON store into the current
 * `SavedTerminalConfig` shape.
 *
 * Never throws and never mutates `raw`. Callers skip malformed entries.
 */
export function migrateSavedConfig(raw: unknown): SavedTerminalConfig | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.type === "string" && "config" in obj) {
    if (obj.config === null || typeof obj.config !== "object") {
      return null;
    }
    if ("version" in obj && obj.version !== SAVED_SESSION_CONFIG_VERSION) {
      return null;
    }
    const id = String(obj.id ?? "");
    const name = String(obj.name ?? "");
    const displayConfig =
      obj.displayConfig !== undefined && obj.displayConfig !== null
        ? { displayConfig: obj.displayConfig as SavedTerminalConfig["displayConfig"] }
        : {};
    if (obj.type === "local") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "local",
        config: obj.config as LocalTerminalConfig,
        ...displayConfig,
      };
    }
    if (obj.type === "ssh") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "ssh",
        config: obj.config as SshConfig,
        ...displayConfig,
      };
    }
    if (obj.type === "tmux-pane") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "tmux-pane",
        config: obj.config as TmuxSessionConfig,
        ...displayConfig,
      };
    }
    return null;
  }

  if (obj.type === "local" && "localConfig" in obj) {
    const localConfig = obj.localConfig;
    if (localConfig === null || typeof localConfig !== "object") {
      return null;
    }
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" ? obj.name : "";
    if (!id || !name) {
      return null;
    }
    return {
      id,
      name,
      version: SAVED_SESSION_CONFIG_VERSION,
      type: "local",
      config: localConfig as LocalTerminalConfig,
      ...(obj.displayConfig !== undefined && obj.displayConfig !== null
        ? { displayConfig: obj.displayConfig as SavedTerminalConfig["displayConfig"] }
        : {}),
    };
  }

  if (obj.type === "ssh" && "sshConfig" in obj) {
    const sshConfig = obj.sshConfig;
    if (sshConfig === null || typeof sshConfig !== "object") {
      return null;
    }
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" ? obj.name : "";
    if (!id || !name) {
      return null;
    }
    return {
      id,
      name,
      version: SAVED_SESSION_CONFIG_VERSION,
      type: "ssh",
      config: sshConfig as SshConfig,
      ...(obj.displayConfig !== undefined && obj.displayConfig !== null
        ? { displayConfig: obj.displayConfig as SavedTerminalConfig["displayConfig"] }
        : {}),
    };
  }

  return null;
}

/**
 * Migrate every valid entry and drop malformed entries with one warning each.
 */
export function migrateSavedConfigList(raw: unknown): SavedTerminalConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const migrated: SavedTerminalConfig[] = [];
  for (const entry of raw) {
    const result = migrateSavedConfig(entry);
    if (result !== null) {
      migrated.push(result);
    } else {
      console.warn(
        "launchConfigStorage: skipping malformed saved terminal config (missing 'type' or unrecognised shape)",
        entry,
      );
    }
  }
  return migrated;
}

export async function loadSavedConfigs(): Promise<SavedTerminalConfig[]> {
  logger.debug("launchConfigStorage", "loadSavedConfigs", undefined);
  try {
    const raw = await launchConfigStore.get<unknown>("savedConfigs");
    const configs = migrateSavedConfigList(raw ?? []);
    logger.debug("launchConfigStorage", "loadSavedConfigs:result", { count: configs.length });
    return configs;
  } catch (error) {
    console.error("Failed to load launch configs:", error);
    return [];
  }
}

export async function persistConfigs(configs: SavedTerminalConfig[]): Promise<void> {
  logger.debug("launchConfigStorage", "persistConfigs", { count: configs.length });
  try {
    await launchConfigStore.set("savedConfigs", configs);
    logger.debug("launchConfigStorage", "persistConfigs:result", undefined);
  } catch (error) {
    console.error("Failed to save launch configs:", error);
  }
}

export async function loadSavedGroups(): Promise<LaunchConfigGroupStore> {
  logger.debug("launchConfigStorage", "loadSavedGroups", undefined);
  try {
    const [groups, nextGroupId] = await Promise.all([
      launchConfigStore.get<TerminalGroup[]>("groups"),
      launchConfigStore.get<number>("nextGroupId"),
    ]);
    const result = { groups: groups ?? [], nextGroupId: nextGroupId || 1 };
    logger.debug("launchConfigStorage", "loadSavedGroups:result", {
      groupCount: result.groups.length,
      nextGroupId: result.nextGroupId,
    });
    return result;
  } catch (error) {
    console.error("Failed to load launch config groups:", error);
    return { groups: [], nextGroupId: 1 };
  }
}

export async function persistGroups(groupsData: LaunchConfigGroupStore): Promise<void> {
  logger.debug("launchConfigStorage", "persistGroups", {
    groupCount: groupsData.groups.length,
    nextGroupId: groupsData.nextGroupId,
  });
  try {
    await launchConfigStore.set("groups", groupsData.groups, false);
    await launchConfigStore.set("nextGroupId", groupsData.nextGroupId, false);
    await launchConfigStore.save();
    logger.debug("launchConfigStorage", "persistGroups:result", undefined);
  } catch (error) {
    console.error("Failed to save launch config groups:", error);
  }
}
