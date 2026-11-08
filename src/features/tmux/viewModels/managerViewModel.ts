import { type SavedTerminalConfig } from "../../../models/legacy/terminal";

export interface TmuxManagerItemViewData {
  configId: string;
  name: string;
  tmuxSessionName?: string;
  socketName?: string;
  baseConfigName?: string;
  transport: "local" | "ssh";
}

export function selectTmuxManagerItems(
  savedConfigs: readonly SavedTerminalConfig[],
): readonly TmuxManagerItemViewData[] {
  const configNames = new Map(savedConfigs.map((config) => [config.id, config.name]));

  return savedConfigs
    .filter((config) => config.type === "tmux-pane")
    .map((config) => ({
      configId: config.id,
      name: config.name,
      ...(config.config.tmuxSessionName ? { tmuxSessionName: config.config.tmuxSessionName } : {}),
      ...(config.config.socketName ? { socketName: config.config.socketName } : {}),
      ...(config.config.baseConfigId && configNames.has(config.config.baseConfigId)
        ? { baseConfigName: configNames.get(config.config.baseConfigId) }
        : {}),
      transport: config.config.ssh ? "ssh" : "local",
    }));
}
