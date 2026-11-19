import { loadGlobalLocalEcho, persistGlobalLocalEcho } from "./settingsStorage";

export interface SettingsRepository {
  loadGlobalLocalEcho: () => Promise<boolean | undefined>;
  persistGlobalLocalEcho: (value: boolean) => Promise<void>;
}

export const settingsRepository: SettingsRepository = {
  loadGlobalLocalEcho,
  persistGlobalLocalEcho,
};
