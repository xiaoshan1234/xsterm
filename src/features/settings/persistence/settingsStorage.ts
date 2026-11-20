import { getJsonStore } from "../../../infra/storage";
import { sanitizeKeybindingOverrides } from "../keybindings/keybindingResolution";
import type { KeybindingsConfig, KeybindingEntry } from "../keybindings/keybindingContracts";

const settingsStore = getJsonStore("settings.json");
const GLOBAL_LOCAL_ECHO_KEY = "globalLocalEcho";
const KEYBINDINGS_KEY = "keybindings";

export async function loadGlobalLocalEcho(): Promise<boolean | undefined> {
  return settingsStore.get<boolean>(GLOBAL_LOCAL_ECHO_KEY);
}

export async function persistGlobalLocalEcho(value: boolean): Promise<void> {
  await settingsStore.set(GLOBAL_LOCAL_ECHO_KEY, value);
}

export async function loadKeybindingsOverrides(): Promise<KeybindingEntry[] | undefined> {
  const raw = await settingsStore.get<Partial<KeybindingsConfig>>(KEYBINDINGS_KEY);
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw.overrides)) {
    return undefined;
  }
  return sanitizeKeybindingOverrides(raw.overrides);
}

export async function persistKeybindingsOverrides(overrides: KeybindingEntry[]): Promise<void> {
  const config: KeybindingsConfig = { version: 1, overrides };
  await settingsStore.set(KEYBINDINGS_KEY, config);
}
