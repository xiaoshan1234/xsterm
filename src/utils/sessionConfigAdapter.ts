/**
 * sessionConfigAdapter.ts
 *
 * Extracts the backend-compatible `LocalSessionConfig` / `SSHSessionConfig`
 * from the new layered `SavedSessionConfig` shape.
 *
 * The backend (Phase 2) now accepts `system` and `terminal` fields in addition
 * to the flat spec fields. tcp/serial/telnet are widened in the type union but
 * disabled in Phase 1; they are guarded here and return an error string.
 */

import {
  SavedSessionConfig,
  LocalSessionConfig,
  SSHSessionConfig,
  LocalSessionSpec,
  SshSessionSpec,
} from "../types/session";

/**
 * Extract a `LocalSessionConfig` from a `SavedSessionConfig`.
 * Includes the spec fields plus the system/terminal layers.
 */
export function toBackendLocalConfig(
  savedConfig: SavedSessionConfig
): LocalSessionConfig {
  const spec = savedConfig.spec as LocalSessionSpec;
  return {
    shell: spec.shell,
    cwd: spec.cwd,
    args: spec.args,
    system: savedConfig.system,
    terminal: savedConfig.terminal,
  };
}

/**
 * Extract a `SSHSessionConfig` from a `SavedSessionConfig`.
 * Includes the spec fields plus the system/terminal layers.
 */
export function toBackendSshConfig(
  savedConfig: SavedSessionConfig
): SSHSessionConfig {
  const spec = savedConfig.spec as SshSessionSpec;
  return {
    host: spec.host,
    port: spec.port,
    username: spec.username,
    auth_type: spec.auth_type,
    password: spec.password,
    key_file: spec.key_file,
    passphrase: spec.passphrase,
    system: savedConfig.system,
    terminal: savedConfig.terminal,
  };
}

/**
 * Unified entry point: converts a layered `SavedSessionConfig` to the
 * backend shape.
 *
 * Returns the backend config on success, or an error string for session types
 * that are not yet implemented.
 */
export function toBackendConfig(
  savedConfig: SavedSessionConfig
): LocalSessionConfig | SSHSessionConfig | string {
  switch (savedConfig.type) {
    case "local":
      return toBackendLocalConfig(savedConfig);
    case "ssh":
      return toBackendSshConfig(savedConfig);
    default:
      return `Session type "${savedConfig.type}" is not implemented in Phase 1`;
  }
}
