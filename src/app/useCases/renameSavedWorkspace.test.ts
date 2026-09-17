import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  savedWorkspaces: [
    { id: "s1", name: "snap" },
    { id: "s2", name: "other" },
  ] as Array<{ id: string; name: string }>,
  renameSavedWorkspace: vi.fn(),
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({
      savedWorkspaces: mocks.savedWorkspaces,
      renameSavedWorkspace: mocks.renameSavedWorkspace,
    }),
  },
}));

import { renameSavedWorkspace } from "./renameSavedWorkspace";

describe("renameSavedWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames a saved workspace", () => {
    renameSavedWorkspace("s1", "renamed");
    expect(mocks.renameSavedWorkspace).toHaveBeenCalledWith("s1", "renamed");
  });

  it("refuses the reserved 'default' name", () => {
    expect(() => renameSavedWorkspace("s1", "default")).toThrow("Workspace name is reserved");
  });

  it("rejects duplicate names", () => {
    expect(() => renameSavedWorkspace("s1", "other")).toThrow("Workspace name already exists");
  });
});
