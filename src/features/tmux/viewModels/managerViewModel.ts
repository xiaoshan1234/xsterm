import { type SavedTerminalConfig } from "../../../models/legacy/terminal";

export interface TmuxManagerItemViewData {
  configId: string;
  name: string;
  tmuxSessionName?: string;
  socketName?: string;
  baseConfigId?: string;
  baseConfigName?: string;
  wslDistribution?: string;
  transport: "local" | "wsl" | "ssh";
}

export interface TmuxManagerGroupViewData {
  key: string;
  name: string;
  items: readonly TmuxManagerItemViewData[];
}

export function selectTmuxManagerGroups(
  savedConfigs: readonly SavedTerminalConfig[],
): readonly TmuxManagerGroupViewData[] {
  const configNames = new Map(savedConfigs.map((config) => [config.id, config.name]));

  const items: TmuxManagerItemViewData[] = savedConfigs
    .filter((config) => config.type === "tmux-pane")
    .map((config): TmuxManagerItemViewData => ({
      configId: config.id,
      name: config.name,
      ...(config.config.tmuxSessionName ? { tmuxSessionName: config.config.tmuxSessionName } : {}),
      ...(config.config.socketName ? { socketName: config.config.socketName } : {}),
      ...(config.config.baseConfigId ? { baseConfigId: config.config.baseConfigId } : {}),
      ...(config.config.baseConfigId && configNames.has(config.config.baseConfigId)
        ? { baseConfigName: configNames.get(config.config.baseConfigId) }
        : {}),
      ...(config.config.wslDistribution ? { wslDistribution: config.config.wslDistribution } : {}),
      transport: config.config.ssh ? "ssh" : config.config.transport === "wsl" ? "wsl" : "local",
    }));

  const groups = new Map<string, { key: string; name: string; items: TmuxManagerItemViewData[] }>();
  for (const item of items) {
    const key =
      item.baseConfigId && item.baseConfigName ? `base:${item.baseConfigId}` : "unassigned";
    const name = item.baseConfigName ?? "Unassigned";
    const group = groups.get(key) ?? { key, name, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
