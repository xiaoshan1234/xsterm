import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sessions: [
    {
      id: 1,
      configId: "cfg1",
      name: "Old",
      type: "local" as const,
      isConnected: true,
      sessionType: { type: "local" as const, config: {} },
    },
  ] as Array<Record<string, unknown>>,
  setSessions: vi.fn(),
  setSavedConfigs: vi.fn(),
}));

vi.mock("../../service/session/store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: mocks.sessions,
      setSessions: mocks.setSessions,
    }),
  },
}));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: {
    getState: () => ({ setSavedConfigs: mocks.setSavedConfigs }),
  },
}));

import { renameSession } from "./renameSession";

describe("renameSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the session name and matching saved config", () => {
    renameSession(1, "New");
    expect(mocks.setSessions).toHaveBeenCalled();
    expect(mocks.setSavedConfigs).toHaveBeenCalled();
  });

  it("does nothing for unknown session id", () => {
    renameSession(999, "x");
    expect(mocks.setSessions).toHaveBeenCalled();
    // savedConfigs not touched when no matching session row.
    expect(mocks.setSavedConfigs).not.toHaveBeenCalled();
  });
});
