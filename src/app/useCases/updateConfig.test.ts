import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ upsertSavedConfig: vi.fn() }));

vi.mock("../../service/persistence/store", () => ({
  usePersistenceStore: { getState: () => ({ upsertSavedConfig: mocks.upsertSavedConfig }) },
}));

import { updateConfig } from "./updateConfig";

describe("updateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a config", () => {
    const config = {
      id: "cfg1",
      name: "L",
      version: 1,
      type: "local",
      config: {},
    } as any;
    updateConfig(config);
    expect(mocks.upsertSavedConfig).toHaveBeenCalledWith(config);
  });
});