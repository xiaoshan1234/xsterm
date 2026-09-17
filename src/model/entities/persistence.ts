import type {
  LocalSessionConfig,
  SSHSessionConfig,
  SessionDisplayConfig,
  SessionType,
  TmuxCcConfig,
} from "./session";

export interface SavedSessionConfig {
  id: string;
  name: string;
  version: number;
  type: SessionType["type"];
  config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig;
  displayConfig?: SessionDisplayConfig;
}

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
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
    // tmux control-mode saved configs pass through unchanged. The
    // migration matrix above only matched `local` / `ssh` previously, so
    // tmux-cc entries would silently drop. Add the branch here so a user
    // who ticked "Save config" on the Tmux tab can reload and find their
    // session again.
    if (obj.type === "tmux-cc") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "tmux-cc",
        config: obj.config as TmuxCcConfig,
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
