/**
 * Old-config fallback loader for the layered SavedSessionConfig migration.
 *
 * Old flat shape: { id, name, type, localConfig?, sshConfig? }
 * New layered shape: { id, name, type, groupId, spec, system, terminal }
 *
 * This module normalizes old flat configs to the new layered shape at load time.
 * No persistence writes occur during normalization.
 *
 * @module utils/sessionConfigMigration
 */

import type {
  SavedSessionConfig,
  LocalSessionSpec,
  SshSessionSpec,
  SessionSpec,
  TerminalConfig,
} from "../types/session";
import {
  getDefaultSystemConfig,
  detectDefaultProfileForType,
} from "../constants/systemProfiles";

// ---------------------------------------------------------------------------
// Terminal config default
// ---------------------------------------------------------------------------

const DEFAULT_TERMINAL: TerminalConfig = {
  scrollbackLines: 5000,
  autoLogPath: "",
  highlightKeywords: "",
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** True when `raw` has the old flat shape (localConfig or sshConfig present). */
function isOldFlatConfig(
  raw: Record<string, unknown>,
): raw is { id: string; name: string; type: string; localConfig?: unknown; sshConfig?: unknown } {
  return "localConfig" in raw || "sshConfig" in raw;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeLocalSpec(raw: unknown): LocalSessionSpec {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      shell: typeof r.shell === "string" ? r.shell : undefined,
      cwd: typeof r.cwd === "string" ? r.cwd : undefined,
      args: Array.isArray(r.args)
        ? (r.args.filter((a): a is string => typeof a === "string"))
        : undefined,
    };
  }
  return {};
}

function normalizeSshSpec(raw: unknown): SshSessionSpec {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      host: typeof r.host === "string" ? r.host : "",
      port: typeof r.port === "number" ? r.port : 22,
      username: typeof r.username === "string" ? r.username : "",
      auth_type:
        r.auth_type === "password" || r.auth_type === "key"
          ? (r.auth_type as "password" | "key")
          : "password",
      password: typeof r.password === "string" ? r.password : undefined,
      key_file: typeof r.key_file === "string" ? r.key_file : undefined,
      passphrase: typeof r.passphrase === "string" ? r.passphrase : undefined,
    };
  }
  return { host: "", port: 22, username: "", auth_type: "password" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes an unknown-loaded config to the layered `SavedSessionConfig` shape.
 *
 * - Pass-through: already-layered configs (have `spec`, `system`, `terminal`) are
 *   returned as-is after a light unknown→known cast.
 * - Old flat: converts `localConfig`/`sshConfig` → `spec`, fills `system` from
 *   `getDefaultSystemConfig(detectDefaultProfileForType(type))`, fills `terminal`
 *   with defaults, sets `groupId` to `null`.
 * - tcp/serial/telnet: handled as-is with empty `spec` if they somehow appear
 *   in old data.
 *
 * @param config - Raw unknown value loaded from `sessions.json`.
 */
export function normalizeSavedConfig(config: unknown): SavedSessionConfig {
  // Safe base defaults for any shape
  const id = typeof config === "object" && config !== null && "id" in config
    ? String((config as Record<string, unknown>).id)
    : "";
  const name = typeof config === "object" && config !== null && "name" in config
    ? String((config as Record<string, unknown>).name)
    : "";
  const type = typeof config === "object" && config !== null && "type" in config
    ? String((config as Record<string, unknown>).type)
    : "local";

  // Already layered — return as SavedSessionConfig
  if (
    typeof config === "object" &&
    config !== null &&
    "spec" in config &&
    "system" in config &&
    "terminal" in config
  ) {
    const c = config as SavedSessionConfig;
    return {
      id: c.id ?? id,
      name: c.name ?? name,
      type: c.type ?? (type as SavedSessionConfig["type"]),
      groupId: c.groupId ?? null,
      spec: c.spec ?? (type === "ssh" ? normalizeSshSpec(null) : normalizeLocalSpec(null)),
      system: c.system ?? getDefaultSystemConfig(
        type === "ssh" ? "ssh" : detectDefaultProfileForType("local"),
      ),
      terminal: c.terminal ?? { ...DEFAULT_TERMINAL },
    };
  }

  // Old flat shape — migrate to layered
  if (typeof config === "object" && config !== null && isOldFlatConfig(config as Record<string, unknown>)) {
    const c = config as Record<string, unknown>;
    const resolvedType = c.type as string;

    let spec: SessionSpec;
    if ("localConfig" in c) {
      spec = normalizeLocalSpec(c.localConfig);
    } else if ("sshConfig" in c) {
      spec = normalizeSshSpec(c.sshConfig);
    } else {
      // tcp/serial/telnet — empty spec, let the system/profile defaults fill the rest
      spec = {} as SessionSpec;
    }

    const profileType: "local" | "ssh" =
      resolvedType === "ssh" ? "ssh" : "local";
    const systemProfile =
      resolvedType === "ssh" || resolvedType === "local"
        ? getDefaultSystemConfig(detectDefaultProfileForType(profileType))
        : getDefaultSystemConfig("none");
    return {
      id: id || String(c.id ?? ""),
      name: name || String(c.name ?? ""),
      type: resolvedType as SavedSessionConfig["type"],
      groupId: null,
      spec,
      system: systemProfile,
      terminal: { ...DEFAULT_TERMINAL },
    };
  }

  // Fallback for anything else — return a minimal safe config
  const safeType: "local" | "ssh" = type === "ssh" ? "ssh" : "local";
  return {
    id,
    name,
    type: safeType,
    groupId: null,
    spec: safeType === "ssh" ? normalizeSshSpec(null) : normalizeLocalSpec(null),
    system: getDefaultSystemConfig(detectDefaultProfileForType(safeType)),
    terminal: { ...DEFAULT_TERMINAL },
  };
}
