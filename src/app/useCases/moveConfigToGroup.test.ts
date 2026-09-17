import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const groups = [
    { id: 1, name: "g1", configIds: ["cfg1", "cfg2"], collapsed: false },
    { id: 2, name: "g2", configIds: [], collapsed: false },
  ];
  return { groups, setGroups: vi.fn() };
});

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ groups: mocks.groups, setGroups: mocks.setGroups }) },
}));

import { moveConfigToGroup } from "./moveConfigToGroup";

describe("moveConfigToGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a config to a target group", () => {
    const stateAfterRemove = [
      { id: 1, name: "g1", configIds: ["cfg2"], collapsed: false },
      { id: 2, name: "g2", configIds: [], collapsed: false },
    ];
    moveConfigToGroup("cfg1", 2);
    const addUpdater = mocks.setGroups.mock.calls[1][0];
    const final = addUpdater(stateAfterRemove);
    expect(final[1].configIds).toContain("cfg1");
    expect(final[0].configIds).not.toContain("cfg1");
  });

  it("removes the config from every group when target is null", () => {
    moveConfigToGroup("cfg1", null);
    expect(mocks.setGroups).toHaveBeenCalledTimes(1);
    const final = mocks.setGroups.mock.calls[0][0](mocks.groups);
    expect(final.every((g: { configIds: string[] }) => !g.configIds.includes("cfg1"))).toBe(true);
  });
});
