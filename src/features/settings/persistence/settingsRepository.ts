import {
  loadGlobalLocalEcho,
  loadKeybindingsOverrides,
  persistGlobalLocalEcho,
  persistKeybindingsOverrides,
} from "./settingsStorage";
import type { KeybindingEntry } from "../keybindings/keybindingContracts";

export interface SettingsRepository {
  loadGlobalLocalEcho: () => Promise<boolean | undefined>;
  persistGlobalLocalEcho: (value: boolean) => Promise<void>;
  loadKeybindingsOverrides: () => Promise<KeybindingEntry[] | undefined>;
  persistKeybindingsOverrides: (overrides: KeybindingEntry[]) => Promise<void>;
}

export const settingsRepository: SettingsRepository = {
  loadGlobalLocalEcho,
  persistGlobalLocalEcho,
  loadKeybindingsOverrides,
  persistKeybindingsOverrides,
};
