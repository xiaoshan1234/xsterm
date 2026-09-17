import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ toggleGroup: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ toggleGroup: mocks.toggleGroup }) },
}));

import { toggleGroup } from "./toggleGroup";

describe("toggleGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards id", () => {
    toggleGroup(2);
    expect(mocks.toggleGroup).toHaveBeenCalledWith(2);
  });
});