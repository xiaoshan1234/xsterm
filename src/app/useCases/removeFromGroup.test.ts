import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ removeConfigFromGroup: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ removeConfigFromGroup: mocks.removeConfigFromGroup }) },
}));

import { removeFromGroup } from "./removeFromGroup";

describe("removeFromGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards groupId and configId", () => {
    removeFromGroup(2, "cfg1");
    expect(mocks.removeConfigFromGroup).toHaveBeenCalledWith(2, "cfg1");
  });
});