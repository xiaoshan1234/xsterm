/**
 * lib/config.ts — reads ssh-config.json (never creates it)
 */

import path from "node:path";
import fs from "node:fs";

const SSH_CONFIG_PATH = path.join(import.meta.dirname, "..", "ssh-config.json");

export interface SshTestConfig {
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password: string;
  keyFile: string;
  passphrase: string;
  disconnectCommand: string;
}

export interface SshConfigResult {
  config: SshTestConfig | null;
  warn: string | null;
}

/**
 * Reads and parses `test/sys-test/ssh-config.json`.
 * Returns { config: null, warn: string } if absent or invalid.
 */
export function loadSshConfig(): SshConfigResult {
  if (!fs.existsSync(SSH_CONFIG_PATH)) {
    return { config: null, warn: `ssh-config.json not found at ${SSH_CONFIG_PATH}` };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(SSH_CONFIG_PATH, "utf8"));
    const config: SshTestConfig = {
      host: String(raw.host ?? ""),
      port: Number(raw.port ?? 22),
      username: String(raw.username ?? ""),
      authType: raw.authType === "key" ? "key" : "password",
      password: String(raw.password ?? ""),
      keyFile: String(raw.keyFile ?? ""),
      passphrase: String(raw.passphrase ?? ""),
      disconnectCommand: String(raw.disconnectCommand ?? "exit"),
    };
    if (!config.host) {
      return { config: null, warn: "ssh-config.json has no 'host' field" };
    }
    return { config, warn: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { config: null, warn: `Failed to parse ssh-config.json: ${msg}` };
  }
}
