/**
 * System profile defaults and helpers for the layered session config.
 * @module constants/systemProfiles
 */

import type { SystemConfig, SystemProfile } from "../types/session";

// ---------------------------------------------------------------------------
// Profile defaults
// ---------------------------------------------------------------------------

/** Agreed default values per system profile. */
export const SYSTEM_PROFILES: Record<SystemProfile, SystemConfig> = {
  windows: {
    newline: "\r\n",
    terminalType: "xterm-256color",
    charset: "UTF-8",
    backspace: "^H",
    delete: "^[[3~",
    mouseScroll: "page",
    signalKey: "^C",
  },
  linux: {
    newline: "\n",
    terminalType: "xterm-256color",
    charset: "UTF-8",
    backspace: "^?",
    delete: "^[[3~",
    mouseScroll: "line",
    signalKey: "^C",
  },
  wsl: {
    newline: "\n",
    terminalType: "xterm-256color",
    charset: "UTF-8",
    backspace: "^H",
    delete: "^[[3~",
    mouseScroll: "line",
    signalKey: "^C",
  },
  ssh: {
    newline: "\n",
    terminalType: "xterm-256color",
    charset: "UTF-8",
    backspace: "^?",
    delete: "^[[3~",
    mouseScroll: "line",
    signalKey: "^C",
  },
  none: {
    newline: "\n",
    terminalType: "xterm-256color",
    charset: "UTF-8",
    backspace: "",
    delete: "",
    mouseScroll: "line",
    signalKey: "^C",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Label used in the UI when no preset profile matches. */
export const CUSTOM_PROFILE_LABEL = "Custom" as const;

/**
 * Returns the full default SystemConfig for a given profile.
 * @param profile - A valid SystemProfile key
 */
export function getDefaultSystemConfig(profile: SystemProfile): SystemConfig {
  return { ...SYSTEM_PROFILES[profile] };
}

/**
 * Detects the default profile for a session type.
 * local → windows on Win32, linux otherwise
 * ssh   → ssh
 */
export function detectDefaultProfileForType(
  type: "local" | "ssh",
): SystemProfile {
  if (type === "ssh") return "ssh";
  // local: platform-aware using navigator.platform (available in Tauri webview)
  const platform =
    typeof navigator !== "undefined" ? navigator.platform : "";
  return platform.toLowerCase().startsWith("win") ? "windows" : "linux";
}

/**
 * Returns true when any field in `systemConfig` differs from the
 * defaults of `profile`.
 */
export function isCustomProfile(
  systemConfig: SystemConfig,
  profile: SystemProfile,
): boolean {
  const defaults = SYSTEM_PROFILES[profile];
  return (
    systemConfig.newline !== defaults.newline ||
    systemConfig.terminalType !== defaults.terminalType ||
    systemConfig.charset !== defaults.charset ||
    systemConfig.backspace !== defaults.backspace ||
    systemConfig.delete !== defaults.delete ||
    systemConfig.mouseScroll !== defaults.mouseScroll ||
    systemConfig.signalKey !== defaults.signalKey
  );
}

/**
 * Finds the profile whose defaults match `systemConfig`.
 * Returns `"Custom"` if no preset matches.
 *
 * Note: linux and ssh share identical defaults. ssh is checked first
 * so SSH sessions return "ssh" rather than "linux".
 */
export function detectProfileFromSystemConfig(
  systemConfig: SystemConfig,
): SystemProfile | "Custom" {
  const profiles = Object.keys(SYSTEM_PROFILES) as SystemProfile[];
  // Check ssh before linux (same defaults, ssh is more specific)
  const order: SystemProfile[] = profiles.sort((a, b) => {
    if (a === "ssh") return -1;
    if (b === "ssh") return 1;
    return 0;
  });
  for (const profile of order) {
    if (!isCustomProfile(systemConfig, profile)) {
      return profile;
    }
  }
  return "Custom";
}
