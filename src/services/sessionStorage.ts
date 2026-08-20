import { load, type Store } from "@tauri-apps/plugin-store";
import { logger } from "../contexts/LoggerContext";
import {
  type LocalSessionConfig,
  type PaneNode,
  type SavedSessionConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type SessionGroup,
  type SSHSessionConfig,
} from "../types/session";

interface GroupStore {
  groups: SessionGroup[];
  nextGroupId: number;
}

/**
 * Schema versions of the `SavedSessionConfig` on-disk format.
 * - v0 (legacy, pre-T3): `{type, localConfig|sshConfig, id, name, displayConfig?}`
 * - v1 (current): `{type, config, version, id, name, displayConfig?}`
 */
export const SAVED_SESSION_CONFIG_VERSION = 1;

/**
 * Migrate a raw entry read from the persisted JSON store into the current
 * `SavedSessionConfig` shape.
 *
 * Behavior:
 * - v1 shape (`type` + `config` + `version`): return as-is after validating
 *   `version` against {@link SAVED_SESSION_CONFIG_VERSION}; any other version is
 *   rejected as malformed so callers can skip it.  Because the function uses
 *   `as LocalSessionConfig` / `as SSHSessionConfig` type assertions, any
 *   additional fields present in the v1 payload (e.g. shellTemplate, termType,
 *   tcpNoDelay, etc.) are carried through automatically — TypeScript's
 *   structural type system does not strip unknown fields from a cast result.
 * - Legacy v0 local (`{type:"local", localConfig:{...}}`): convert to
 *   `{type:"local", config: localConfig, version: 1}`.
 * - Legacy v0 ssh (`{type:"ssh", sshConfig:{...}}`): convert to
 *   `{type:"ssh", config: sshConfig, version: 1}`.
 * - Anything else (missing `type`, no config sibling, etc.): return `null`.
 *
 * Never throws; never mutates `raw`.
 */
export function migrateSavedConfig(raw: unknown): SavedSessionConfig | null {
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
        ? { displayConfig: obj.displayConfig as SavedSessionConfig["displayConfig"] }
        : {};
    if (obj.type === "local") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "local",
        config: obj.config as LocalSessionConfig,
        ...displayConfig,
      };
    }
    if (obj.type === "ssh") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "ssh",
        config: obj.config as SSHSessionConfig,
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
      config: localConfig as LocalSessionConfig,
      ...(obj.displayConfig !== undefined && obj.displayConfig !== null
        ? { displayConfig: obj.displayConfig as SavedSessionConfig["displayConfig"] }
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
      config: sshConfig as SSHSessionConfig,
      ...(obj.displayConfig !== undefined && obj.displayConfig !== null
        ? { displayConfig: obj.displayConfig as SavedSessionConfig["displayConfig"] }
        : {}),
    };
  }

  return null;
}

/**
 * Run each element of `raw` through {@link migrateSavedConfig}, drop the nulls
 * with a single `console.warn` per skip, and return the survivors in order.
 */
export function migrateSavedConfigList(raw: unknown): SavedSessionConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const migrated: SavedSessionConfig[] = [];
  for (const entry of raw) {
    const result = migrateSavedConfig(entry);
    if (result !== null) {
      migrated.push(result);
    } else {
      console.warn(
        "sessionStorage: skipping malformed saved session config (missing 'type' or unrecognised shape)",
        entry,
      );
    }
  }
  return migrated;
}

let storeInstance: Store | null = null;
let settingsStoreInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load("sessions.json", { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function getSettingsStore(): Promise<Store> {
  if (!settingsStoreInstance) {
    settingsStoreInstance = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return settingsStoreInstance;
}

export async function loadSavedConfigs(): Promise<SavedSessionConfig[]> {
  logger.debug("sessionStorage", "loadSavedConfigs", undefined);
  try {
    const store = await getStore();
    const raw = await store.get<unknown>("savedConfigs");
    const configs = migrateSavedConfigList(raw ?? []);
    logger.debug("sessionStorage", "loadSavedConfigs:result", { count: configs.length });
    return configs;
  } catch (e) {
    console.error("Failed to load configs:", e);
    return [];
  }
}

export async function persistConfigs(configs: SavedSessionConfig[]): Promise<void> {
  logger.debug("sessionStorage", "persistConfigs", { count: configs.length });
  try {
    const store = await getStore();
    await store.set("savedConfigs", configs);
    await store.save();
    logger.debug("sessionStorage", "persistConfigs:result", undefined);
  } catch (e) {
    console.error("Failed to save configs:", e);
  }
}

export async function loadSavedGroups(): Promise<GroupStore> {
  logger.debug("sessionStorage", "loadSavedGroups", undefined);
  try {
    const store = await getStore();
    const groups = await store.get<SessionGroup[]>("groups");
    const nextGroupId = (await store.get<number>("nextGroupId")) || 1;
    const result = { groups: groups || [], nextGroupId };
    logger.debug("sessionStorage", "loadSavedGroups:result", {
      groupCount: result.groups.length,
      nextGroupId,
    });
    return result;
  } catch (e) {
    console.error("Failed to load groups:", e);
    return { groups: [], nextGroupId: 1 };
  }
}

export async function persistGroups(groupsData: GroupStore): Promise<void> {
  logger.debug("sessionStorage", "persistGroups", {
    groupCount: groupsData.groups.length,
    nextGroupId: groupsData.nextGroupId,
  });
  try {
    const store = await getStore();
    await store.set("groups", groupsData.groups);
    await store.set("nextGroupId", groupsData.nextGroupId);
    await store.save();
    logger.debug("sessionStorage", "persistGroups:result", undefined);
  } catch (e) {
    console.error("Failed to save groups:", e);
  }
}

export async function loadSavedWindowConfigs(): Promise<SavedWindowConfig[]> {
  logger.debug("sessionStorage", "loadSavedWindowConfigs", undefined);
  try {
    const store = await getStore();
    const configs = (await store.get<SavedWindowConfig[]>("savedWindowConfigs")) || [];
    logger.debug("sessionStorage", "loadSavedWindowConfigs:result", { count: configs.length });
    return configs;
  } catch (e) {
    console.error("Failed to load window configs:", e);
    return [];
  }
}

export async function persistWindowConfigs(configs: SavedWindowConfig[]): Promise<void> {
  logger.debug("sessionStorage", "persistWindowConfigs", { count: configs.length });
  try {
    const store = await getStore();
    await store.set("savedWindowConfigs", configs);
    await store.save();
    logger.debug("sessionStorage", "persistWindowConfigs:result", undefined);
  } catch (e) {
    console.error("Failed to save window configs:", e);
  }
}

export async function deleteSavedWindowConfig(id: string): Promise<void> {
  logger.debug("sessionStorage", "deleteSavedWindowConfig", { id });
  try {
    const store = await getStore();
    const configs = (await store.get<SavedWindowConfig[]>("savedWindowConfigs")) || [];
    const updated = configs.filter((c) => c.id !== id);
    await store.set("savedWindowConfigs", updated);
    await store.save();
    logger.debug("sessionStorage", "deleteSavedWindowConfig:result", { remaining: updated.length });
  } catch (e) {
    console.error("Failed to delete window config:", e);
  }
}

export async function loadSavedWorkspaces(): Promise<SavedWorkspace[]> {
  logger.debug("sessionStorage", "loadSavedWorkspaces", undefined);
  try {
    const store = await getStore();
    const raw =
      (await store.get<(SavedWorkspace & { rootPane?: unknown })[]>("savedWorkspaces")) || [];
    const workspaces = raw.map((w) => {
      if ("rootPane" in w && w.rootPane !== undefined) {
        const legacy = w as SavedWorkspace & {
          rootPane: { id: string; type: "leaf" | "split"; size: number };
        };
        return {
          id: legacy.id,
          name: legacy.name,
          windows: [
            {
              id: crypto.randomUUID(),
              name: legacy.name || "Window",
              rootPane: legacy.rootPane as PaneNode,
            },
          ],
        };
      }
      return w as SavedWorkspace;
    });
    logger.debug("sessionStorage", "loadSavedWorkspaces:result", { count: workspaces.length });
    return workspaces;
  } catch (e) {
    console.error("Failed to load workspaces:", e);
    return [];
  }
}

export async function persistWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  logger.debug("sessionStorage", "persistWorkspaces", { count: workspaces.length });
  try {
    const store = await getStore();
    await store.set("savedWorkspaces", workspaces);
    await store.save();
    logger.debug("sessionStorage", "persistWorkspaces:result", undefined);
  } catch (e) {
    console.error("Failed to save workspaces:", e);
  }
}

export async function deleteSavedWorkspace(id: string): Promise<void> {
  logger.debug("sessionStorage", "deleteSavedWorkspace", { id });
  try {
    const store = await getStore();
    const workspaces = (await store.get<SavedWorkspace[]>("savedWorkspaces")) || [];
    const updated = workspaces.filter((w) => w.id !== id);
    await store.set("savedWorkspaces", updated);
    await store.save();
    logger.debug("sessionStorage", "deleteSavedWorkspace:result", { remaining: updated.length });
  } catch (e) {
    console.error("Failed to delete workspace:", e);
  }
}
