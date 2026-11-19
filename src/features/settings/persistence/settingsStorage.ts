import { getJsonStore } from "../../../infra/storage";

const settingsStore = getJsonStore("settings.json");
const GLOBAL_LOCAL_ECHO_KEY = "globalLocalEcho";

export async function loadGlobalLocalEcho(): Promise<boolean | undefined> {
  return settingsStore.get<boolean>(GLOBAL_LOCAL_ECHO_KEY);
}

export async function persistGlobalLocalEcho(value: boolean): Promise<void> {
  await settingsStore.set(GLOBAL_LOCAL_ECHO_KEY, value);
}
