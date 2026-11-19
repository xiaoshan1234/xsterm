/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalPersistence } from "./useTerminalPersistence";

const mocks = vi.hoisted(() => ({
  loadGlobalLocalEcho: vi.fn(),
  persistGlobalLocalEcho: vi.fn(async () => undefined),
  loadSavedWorkspaces: vi.fn(async () => []),
  loadSavedWindowConfigs: vi.fn(async () => []),
  persistWorkspaces: vi.fn(async () => undefined),
  persistWindowConfigs: vi.fn(async () => undefined),
}));

function createOptions() {
  return {
    setSavedConfigs: vi.fn(),
    setGroups: vi.fn(),
    setNextGroupId: vi.fn(),
    setSavedWorkspaces: vi.fn(),
    setSavedWindowConfigs: vi.fn(),
    setGlobalLocalEcho: vi.fn(),
    savedConfigs: [],
    groups: [],
    globalLocalEcho: false,
    nextGroupId: 1,
    launchConfigRepository: {
      loadConfigs: vi.fn(async () => []),
      loadGroups: vi.fn(async () => ({ groups: [], nextGroupId: 1 })),
      persistConfigs: vi.fn(async () => undefined),
      persistGroups: vi.fn(async () => undefined),
    },
    workspaceRepository: {
      loadWindowConfigs: mocks.loadSavedWindowConfigs,
      loadWorkspaces: mocks.loadSavedWorkspaces,
      persistWindowConfigs: mocks.persistWindowConfigs,
      persistWorkspaces: mocks.persistWorkspaces,
    },
    settingsRepository: {
      loadGlobalLocalEcho: mocks.loadGlobalLocalEcho,
      persistGlobalLocalEcho: mocks.persistGlobalLocalEcho,
    },
  };
}

describe("useTerminalPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not write the default setting before persisted settings finish loading", async () => {
    let resolveSettings: ((value: boolean) => void) | undefined;
    mocks.loadGlobalLocalEcho.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSettings = resolve;
        }),
    );
    const options = createOptions();

    const { result } = renderHook(() => useTerminalPersistence(options));

    expect(mocks.persistGlobalLocalEcho).not.toHaveBeenCalled();
    expect(result.current.isLoaded).toBe(false);

    await act(async () => {
      resolveSettings?.(true);
    });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(options.setGlobalLocalEcho).toHaveBeenCalledWith(true);
    expect(mocks.persistGlobalLocalEcho).not.toHaveBeenCalled();
  });
});
