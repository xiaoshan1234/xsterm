import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextGroupId: 5,
  addGroup: vi.fn(),
  setNextGroupId: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({
      nextGroupId: mocks.nextGroupId,
      addGroup: mocks.addGroup,
      setNextGroupId: mocks.setNextGroupId,
    }),
  },
}));

import { createGroup } from "./createGroup";

describe("createGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a group with the next id and bumps the counter", () => {
    createGroup("MyGroup");
    expect(mocks.addGroup).toHaveBeenCalledWith({
      id: 5,
      name: "MyGroup",
      configIds: [],
      collapsed: false,
    });
    expect(mocks.setNextGroupId).toHaveBeenCalled();
  });
});
