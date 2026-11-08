import { type SavedTerminalConfig, type TerminalGroup } from "../../../types/terminal";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../../sessions";

export type RawTerminalKind = "local" | "ssh";

export interface TerminalManagerItemViewData {
  configId: string;
  name: string;
  kind: RawTerminalKind;
  detail: string;
}

export interface TerminalManagerGroupViewData {
  groupId: number;
  name: string;
  isDefault: boolean;
  isCollapsed: boolean;
  items: readonly TerminalManagerItemViewData[];
}

export function selectTerminalManagerGroups(
  savedConfigs: readonly SavedTerminalConfig[],
  groups: readonly TerminalGroup[],
): readonly TerminalManagerGroupViewData[] {
  const rawConfigs = savedConfigs.filter(isRawTerminalConfig);
  const knownConfigIds = new Set(rawConfigs.map((config) => config.id));
  const defaultGroup =
    groups.find((group) => group.id === DEFAULT_GROUP_ID) ??
    ({
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      configIds: [],
      collapsed: false,
    } satisfies TerminalGroup);
  const customGroups = groups.filter((group) => group.id !== DEFAULT_GROUP_ID);
  const groupedConfigIds = new Set(
    customGroups.flatMap((group) => group.configIds.filter((id) => knownConfigIds.has(id))),
  );

  return [
    {
      groupId: defaultGroup.id,
      name: defaultGroup.name,
      isDefault: true,
      isCollapsed: defaultGroup.collapsed,
      items: rawConfigs
        .filter((config) => !groupedConfigIds.has(config.id))
        .map(toTerminalManagerItem),
    },
    ...customGroups.map((group) => ({
      groupId: group.id,
      name: group.name,
      isDefault: false,
      isCollapsed: group.collapsed,
      items: group.configIds
        .map((configId) => rawConfigs.find((config) => config.id === configId))
        .filter((config): config is RawTerminalSavedConfig => config !== undefined)
        .map(toTerminalManagerItem),
    })),
  ];
}

type RawTerminalSavedConfig = Extract<SavedTerminalConfig, { type: "local" | "ssh" }>;

function isRawTerminalConfig(config: SavedTerminalConfig): config is RawTerminalSavedConfig {
  return config.type === "local" || config.type === "ssh";
}

function toTerminalManagerItem(config: RawTerminalSavedConfig): TerminalManagerItemViewData {
  if (config.type === "local") {
    return {
      configId: config.id,
      name: config.name,
      kind: "local",
      detail: config.config.shellTemplate ?? config.config.shell ?? "Local shell",
    };
  }

  return {
    configId: config.id,
    name: config.name,
    kind: "ssh",
    detail: `${config.config.username}@${config.config.host}:${config.config.port}`,
  };
}
