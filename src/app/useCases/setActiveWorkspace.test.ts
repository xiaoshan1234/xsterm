import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setActiveWorkspace: vi.fn(),
}));

vi.mock("../../service/workspace/store", () => ({
  useWorkspaceStore: { getState: () => ({ setActiveWorkspace: mocks.setActiveWorkspace }) },
}));

import { setActiveWorkspace } from "./setActiveWorkspace";

describe("setActiveWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the store setter", () => {
    setActiveWorkspace("ws1");
    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith("ws1");
  });
});