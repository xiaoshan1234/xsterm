import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ setSessions: vi.fn() }));

vi.mock("../../service/session/store", () => ({
  useSessionStore: { getState: () => ({ setSessions: mocks.setSessions }) },
}));

import { applyDisplayConfigToLiveSession } from "./applyDisplayConfigToLiveSession";

describe("applyDisplayConfigToLiveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("patches the session's displayConfig", () => {
    applyDisplayConfigToLiveSession(1, { fontSize: 14 });
    expect(mocks.setSessions).toHaveBeenCalled();
  });
});
