import { useState, useCallback } from "react";
import type { SystemConfig, SystemProfile } from "../../types/session";
import {
  detectDefaultProfileForType,
  getDefaultSystemConfig,
  detectProfileFromSystemConfig,
} from "../../constants/systemProfiles";

/**
 * Manages system-layer state and profile-label detection for session create/edit dialogs.
 *
 * @param type          - The current session type ("local" or "ssh")
 * @param initialSystem - Optional SystemConfig to seed the state (defaults to type-aware preset)
 * @param initialProfile - Optional profile label override (defaults to detection from initialSystem)
 */
export function useSystemProfile(
  type: "local" | "ssh",
  initialSystem?: SystemConfig,
  initialProfile?: SystemProfile | "Custom",
) {
  // Derive the default system config for the given type when no override is provided
  const defaultProfile = detectDefaultProfileForType(type);
  const defaultSystem = getDefaultSystemConfig(defaultProfile);
  const resolvedProfile: SystemProfile | "Custom" =
    initialProfile ?? detectProfileFromSystemConfig(initialSystem ?? defaultSystem);

  const [system, setSystemState] = useState<SystemConfig>(
    initialSystem ?? defaultSystem,
  );
  const [profile, setProfileState] = useState<SystemProfile | "Custom">(
    resolvedProfile,
  );

  /**
   * Updates the system config and re-derives the profile label.
   * If the new config no longer matches any preset, the label becomes "Custom".
   */
  const setSystem = useCallback((newSystem: SystemConfig) => {
    setSystemState(newSystem);
    setProfileState(detectProfileFromSystemConfig(newSystem));
  }, []);

  /**
   * Resets both system and profile to the defaults for a new session type.
   * Called when the user switches between "local" and "ssh".
   */
  const handleTypeChange = useCallback(
    (newType: "local" | "ssh") => {
      const newDefault = detectDefaultProfileForType(newType);
      setSystemState(getDefaultSystemConfig(newDefault));
      setProfileState(newDefault);
    },
    [],
  );

  return {
    system,
    profile,
    setSystem,
    handleTypeChange,
  };
}
