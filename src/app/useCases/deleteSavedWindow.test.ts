import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ removeSavedWindowConfig: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ removeSavedWindowConfig: mocks.removeSavedWindowConfig }) },
}));

import { deleteSavedWindow } from "./deleteSavedWindow";

describe("deleteSavedWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the id to the persistence store", () => {
    deleteSavedWindow("w1");
    expect(mocks.removeSavedWindowConfig).toHaveBeenCalledWith("w1");
  });
});