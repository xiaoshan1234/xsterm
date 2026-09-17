import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ renameGroup: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ renameGroup: mocks.renameGroup }) },
}));

import { renameGroup } from "./renameGroup";

describe("renameGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards id and name", () => {
    renameGroup(2, "NewName");
    expect(mocks.renameGroup).toHaveBeenCalledWith(2, "NewName");
  });
});
