import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ addConfigToGroup: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ addConfigToGroup: mocks.addConfigToGroup }) },
}));

import { addToGroup } from "./addToGroup";

describe("addToGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards groupId and configId", () => {
    addToGroup(2, "cfg1");
    expect(mocks.addConfigToGroup).toHaveBeenCalledWith(2, "cfg1");
  });
});