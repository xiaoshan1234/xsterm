import { type TerminalGroup } from "../../../models/runtime/terminal";
import { DEFAULT_GROUP_ID } from "../constants";

export function addGroup(
  groups: readonly TerminalGroup[],
  groupId: number,
  name: string,
): TerminalGroup[] {
  return [...groups, { id: groupId, name, configIds: [], collapsed: false }];
}

export function deleteGroup(groups: readonly TerminalGroup[], groupId: number): TerminalGroup[] {
  if (groupId === DEFAULT_GROUP_ID) {
    return [...groups];
  }
  return groups.filter((group) => group.id !== groupId);
}

export function addConfigToGroup(
  groups: readonly TerminalGroup[],
  groupId: number,
  configId: string,
): TerminalGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, configIds: [...group.configIds, configId] } : group,
  );
}

export function removeConfigFromGroup(
  groups: readonly TerminalGroup[],
  groupId: number,
  configId: string,
): TerminalGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          configIds: group.configIds.filter((candidateId) => candidateId !== configId),
        }
      : group,
  );
}

export function moveConfigToGroup(
  groups: readonly TerminalGroup[],
  configId: string,
  targetGroupId: number | null,
): TerminalGroup[] {
  const groupsWithoutConfig = groups.map((group) => ({
    ...group,
    configIds: group.configIds.filter((candidateId) => candidateId !== configId),
  }));

  if (targetGroupId === null) {
    return groupsWithoutConfig;
  }

  return groupsWithoutConfig.map((group) =>
    group.id === targetGroupId ? { ...group, configIds: [...group.configIds, configId] } : group,
  );
}

export function renameGroup(
  groups: readonly TerminalGroup[],
  groupId: number,
  name: string,
): TerminalGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, name } : group));
}

export function toggleGroup(groups: readonly TerminalGroup[], groupId: number): TerminalGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
  );
}
