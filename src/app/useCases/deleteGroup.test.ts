import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ removeGroup: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ removeGroup: mocks.removeGroup }) },
}));

import { deleteGroup } from "./deleteGroup";

describe("deleteGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a non-default group", () => {
    deleteGroup(3);
    expect(mocks.removeGroup).toHaveBeenCalledWith(3);
  });

  it("refuses to remove the default group", () => {
    deleteGroup(0);
    expect(mocks.removeGroup).not.toHaveBeenCalled();
  });
});
