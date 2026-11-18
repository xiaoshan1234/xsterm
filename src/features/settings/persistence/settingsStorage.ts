import { getJsonStore } from "../../../infra/storage";

const settingsStore = getJsonStore("settings.json");

export function getSettingsStore() {
  return settingsStore;
}
