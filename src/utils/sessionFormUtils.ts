import type { SessionTypeKind, SshSessionSpec } from "../types/session";

export const ALL_SESSION_TYPES: SessionTypeKind[] = ["local", "ssh", "tcp", "serial", "telnet"];

export const IMPLEMENTED_TYPES = ["local", "ssh"] as const;

export function isImplementedType(type: SessionTypeKind): boolean {
  return (IMPLEMENTED_TYPES as readonly string[]).includes(type);
}

export function validateSshConfig(config: SshSessionSpec): string | null {
  if (!config.host || !config.username) {
    return "Host and username are required";
  }
  if (config.port < 1 || config.port > 65535) {
    return "Port must be between 1 and 65535";
  }
  if (config.auth_type === "password" && !config.password) {
    return "Password is required";
  }
  if (config.auth_type === "key" && !config.key_file) {
    return "Key file path is required";
  }
  return null;
}
