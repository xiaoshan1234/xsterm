/**
 * On-disk migration helpers for the persisted session store.
 *
 * Pure functions — read raw JSON, return the current shape (or `null`
 * if the entry is unrecognised). Lives in `infra/store/` alongside the
 * `tauri-plugin-store` adapters because the migration matrix is tied
 * to the on-disk format that those adapters read and write.
 *
 * The `PersistedSessionConfig` / `SessionGroup` data shapes themselves live
 * in `src/model/entities/persistence.ts`; this file only owns the
 * version-conversion logic.
 */
import type {
  LocalSessionConfig,
  SSHSessionConfig,
  TmuxCcConfig,
  PersistedSessionConfig,
} from "../../model/session-config";
export type { PersistedSessionConfig };

/**
 * Schema versions of the `PersistedSessionConfig` on-disk format.
 * - v0 (legacy, pre-T3): `{type, localConfig|sshConfig, id, name, displayConfig?}`
 * - v1 (current): `{type, config, version, id, name, displayConfig?}`
 */
export const SAVED_SESSION_CONFIG_VERSION = 1;

/**
 * Migrate a raw entry read from the persisted JSON store into the current
 * `PersistedSessionConfig` shape.
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
export function migrateSavedConfig(raw: unknown): PersistedSessionConfig | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const rawRecord = raw as Record<string, unknown>;

  if (typeof rawRecord.type === "string" && "config" in rawRecord) {
    if (rawRecord.config === null || typeof rawRecord.config !== "object") {
      return null;
    }
    if ("version" in rawRecord && rawRecord.version !== SAVED_SESSION_CONFIG_VERSION) {
      return null;
    }
    const id = String(rawRecord.id ?? "");
    const name = String(rawRecord.name ?? "");
    const displayConfig =
      rawRecord.displayConfig !== undefined && rawRecord.displayConfig !== null
        ? { displayConfig: rawRecord.displayConfig as PersistedSessionConfig["displayConfig"] }
        : {};
    if (rawRecord.type === "local") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "local",
        config: rawRecord.config as LocalSessionConfig,
        ...displayConfig,
      };
    }
    if (rawRecord.type === "ssh") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "ssh",
        config: rawRecord.config as SSHSessionConfig,
        ...displayConfig,
      };
    }
    if (rawRecord.type === "tmux-cc") {
      return {
        id,
        name,
        version: SAVED_SESSION_CONFIG_VERSION,
        type: "tmux-cc",
        config: rawRecord.config as TmuxCcConfig,
        ...displayConfig,
      };
    }
    return null;
  }

  if (rawRecord.type === "local" && "localConfig" in rawRecord) {
    const localConfig = rawRecord.localConfig;
    if (localConfig === null || typeof localConfig !== "object") {
      return null;
    }
    const id = typeof rawRecord.id === "string" ? rawRecord.id : "";
    const name = typeof rawRecord.name === "string" ? rawRecord.name : "";
    if (!id || !name) {
      return null;
    }
    return {
      id,
      name,
      version: SAVED_SESSION_CONFIG_VERSION,
      type: "local",
      config: localConfig as LocalSessionConfig,
      ...(rawRecord.displayConfig !== undefined && rawRecord.displayConfig !== null
        ? { displayConfig: rawRecord.displayConfig as PersistedSessionConfig["displayConfig"] }
        : {}),
    };
  }

  if (rawRecord.type === "ssh" && "sshConfig" in rawRecord) {
    const sshConfig = rawRecord.sshConfig;
    if (sshConfig === null || typeof sshConfig !== "object") {
      return null;
    }
    const id = typeof rawRecord.id === "string" ? rawRecord.id : "";
    const name = typeof rawRecord.name === "string" ? rawRecord.name : "";
    if (!id || !name) {
      return null;
    }
    return {
      id,
      name,
      version: SAVED_SESSION_CONFIG_VERSION,
      type: "ssh",
      config: sshConfig as SSHSessionConfig,
      ...(rawRecord.displayConfig !== undefined && rawRecord.displayConfig !== null
        ? { displayConfig: rawRecord.displayConfig as PersistedSessionConfig["displayConfig"] }
        : {}),
    };
  }

  return null;
}

/**
 * Run each element of `raw` through {@link migrateSavedConfig}, drop the nulls
 * with a single `console.warn` per skip, and return the survivors in order.
 */
export function migrateSavedConfigList(raw: unknown): PersistedSessionConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const migratedList: PersistedSessionConfig[] = [];
  for (const entry of raw) {
    const result = migrateSavedConfig(entry);
    if (result !== null) {
      migratedList.push(result);
    } else {
      console.warn(
        "sessionStorage: skipping malformed saved session config (missing 'type' or unrecognised shape)",
        entry,
      );
    }
  }
  return migratedList;
}
