import { type SavedTerminalConfig } from "../../../models/legacy/terminal";
import { defaultTmuxDisplayName, tmuxSessionBaseKey, tmuxSessionKey } from "./sessionIdentity";

export interface TmuxManagerItemViewData {
  configId: string;
  name: string;
  tmuxSessionName?: string;
  socketName?: string;
  baseConfigId?: string;
  baseConfigName?: string;
  wslDistribution?: string;
  transport: "local" | "wsl" | "ssh";
  isOpen: boolean;
}

export interface TmuxManagerGroupViewData {
  key: string;
  name: string;
  items: readonly TmuxManagerItemViewData[];
}

export function selectTmuxManagerGroups(
  savedConfigs: readonly SavedTerminalConfig[],
  openSessionKeys: ReadonlySet<string> = new Set(),
  openConfigIds: ReadonlySet<string> = new Set(),
  openBaseKeys: ReadonlySet<string> = new Set(),
): readonly TmuxManagerGroupViewData[] {
  const configNames = new Map(savedConfigs.map((config) => [config.id, config.name]));

  const items: TmuxManagerItemViewData[] = savedConfigs
    .filter((config) => config.type === "tmux-pane")
    .map((config): TmuxManagerItemViewData => ({
      configId: config.id,
      name: config.name.trim() || defaultTmuxDisplayName(config.config),
      ...(config.config.tmuxSessionName ? { tmuxSessionName: config.config.tmuxSessionName } : {}),
      ...(config.config.socketName ? { socketName: config.config.socketName } : {}),
      ...(config.config.baseConfigId ? { baseConfigId: config.config.baseConfigId } : {}),
      ...(config.config.baseConfigId && configNames.has(config.config.baseConfigId)
        ? { baseConfigName: configNames.get(config.config.baseConfigId) }
        : {}),
      ...(config.config.wslDistribution ? { wslDistribution: config.config.wslDistribution } : {}),
      transport: config.config.ssh ? "ssh" : config.config.transport === "wsl" ? "wsl" : "local",
      isOpen:
        openConfigIds.has(config.id) ||
        openSessionKeys.has(tmuxSessionKey(config.config)) ||
        openBaseKeys.has(tmuxSessionBaseKey(config.config)),
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
  for (const group of groups.values()) {
    const usedNames = new Set<string>();
    group.items = group.items.map((item) => ({
      ...item,
      name: uniqueName(item.name, usedNames),
    }));
  }
  return [...groups.values()];
}

function uniqueName(name: string, usedNames: Set<string>): string {
  let candidate = name;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${name} (${suffix})`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}
