import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ removeSavedWorkspace: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ removeSavedWorkspace: mocks.removeSavedWorkspace }) },
}));

import { deleteSavedWorkspace } from "./deleteSavedWorkspace";

describe("deleteSavedWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the id to the persistence store", () => {
    deleteSavedWorkspace("snap1");
    expect(mocks.removeSavedWorkspace).toHaveBeenCalledWith("snap1");
  });
});
