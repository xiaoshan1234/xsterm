import { describe, expect, it } from "vitest";
import type { TerminalGroup } from "../../../models/runtime/savedConfig";
import {
  addConfigToGroup,
  addGroup,
  deleteGroup,
  moveConfigToGroup,
  removeConfigFromGroup,
  renameGroup,
  toggleGroup,
} from "./groupOperations";

const groups: TerminalGroup[] = [
  { id: 0, name: "default", configIds: ["config-1"], collapsed: false },
  { id: 1, name: "work", configIds: ["config-2"], collapsed: false },
];

describe("launch config group operations", () => {
  it("adds a new expanded group without mutating the source", () => {
    const result = addGroup(groups, 2, "lab");

    expect(result).toEqual([...groups, { id: 2, name: "lab", configIds: [], collapsed: false }]);
    expect(groups).toHaveLength(2);
  });

  it("does not delete the default group", () => {
    const result = deleteGroup(groups, 0);

    expect(result).toEqual(groups);
    expect(result).not.toBe(groups);
  });

  it("deletes a custom group", () => {
    expect(deleteGroup(groups, 1)).toEqual([groups[0]]);
  });

  it("adds and removes a config id in the selected group", () => {
    const added = addConfigToGroup(groups, 1, "config-3");
    const removed = removeConfigFromGroup(added, 1, "config-2");

    expect(added[1].configIds).toEqual(["config-2", "config-3"]);
    expect(removed[1].configIds).toEqual(["config-3"]);
  });

  it("moves a config between groups in one immutable transition", () => {
    const result = moveConfigToGroup(groups, "config-1", 1);

    expect(result[0].configIds).toEqual([]);
    expect(result[1].configIds).toEqual(["config-2", "config-1"]);
    expect(groups[0].configIds).toEqual(["config-1"]);
  });

  it("removes a config from every group when no target is selected", () => {
    const duplicated = [
      { ...groups[0], configIds: ["config-1"] },
      { ...groups[1], configIds: ["config-1", "config-2"] },
    ];

    const result = moveConfigToGroup(duplicated, "config-1", null);

    expect(result[0].configIds).toEqual([]);
    expect(result[1].configIds).toEqual(["config-2"]);
  });

  it("renames and toggles only the selected group", () => {
    const renamed = renameGroup(groups, 1, "remote");
    const toggled = toggleGroup(renamed, 1);

    expect(toggled[0]).toBe(groups[0]);
    expect(toggled[1]).toMatchObject({ id: 1, name: "remote", collapsed: true });
  });
});
