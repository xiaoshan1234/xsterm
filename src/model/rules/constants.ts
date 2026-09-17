export const DEFAULT_GROUP_ID = 0;
export const DEFAULT_GROUP_NAME = "default";

export function isDefaultGroup(group: { id: number }): boolean {
  return group.id === DEFAULT_GROUP_ID;
}
