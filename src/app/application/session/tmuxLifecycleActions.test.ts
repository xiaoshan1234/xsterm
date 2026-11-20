/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTerminalId } from "../../../models";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import { useTmuxControllerTracking } from "./useTmuxControllerTracking";

const tmuxConfig: TmuxSessionConfig = {
  tmuxSessionName: "work",
  transport: "local",
};

function createTmuxTerminal(): Terminal {
  return {
    id: createTerminalId(7),
    configId: "config-1",
    name: "tmux",
    type: "tmux-pane",
    isConnected: true,
    kind: { type: "tmux-pane", sessionId: 3, paneId: "%1" },
    tmux: { controllerId: 3, paneId: "%1" },
  };
}

function createTrackingOptions() {
  let sessions: Terminal[] = [createTmuxTerminal()];
  let workspaces: Workspace[] = [];
  const syncOpenTmuxSessions = vi.fn();
  const options = {
    savedConfigs: [],
    terminalsRef: { current: sessions },
    setTerminals: vi.fn((action) => {
      sessions = typeof action === "function" ? action(sessions) : action;
      options.terminalsRef.current = sessions;
    }),
    setWorkspaces: vi.fn((action) => {
      workspaces = typeof action === "function" ? action(workspaces) : action;
    }),
    establishingTerminalsRef: { current: new Set([createTerminalId(7)]) },
    updateConfigs: vi.fn(),
    tmuxControllerConfigsRef: { current: new Map([[3, tmuxConfig]]) },
    tmuxControllerConfigIdsRef: { current: new Map([[3, "config-1"]]) },
    syncOpenTmuxSessions,
    pendingTmuxSessionKeysRef: { current: new Set<string>() },
    tmuxControllersClosingRef: { current: new Set<number>() },
  };
  return {
    options,
    getSessions: () => sessions,
    getWorkspaces: () => workspaces,
    syncOpenTmuxSessions,
  };
}

describe("tmux controller tracking", () => {
  it("rejects a concurrent open of the same tmux session", async () => {
    const { options } = createTrackingOptions();
    const { result } = renderHook(() => useTmuxControllerTracking(options));
    let finish: (() => void) | undefined;
    const pending = result.current.withPendingTmuxSession(
      tmuxConfig,
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    await expect(
      result.current.withPendingTmuxSession(tmuxConfig, async () => undefined),
    ).rejects.toMatchObject({ code: "operation-in-progress" });

    finish?.();
    await pending;
  });

  it("removes controller terminals and tracking maps", () => {
    const { options, getSessions, syncOpenTmuxSessions } = createTrackingOptions();
    const { result } = renderHook(() => useTmuxControllerTracking(options));

    act(() => result.current.removeTmuxControllerFromState(3));

    expect(getSessions()).toEqual([]);
    expect(options.tmuxControllerConfigsRef.current.has(3)).toBe(false);
    expect(options.tmuxControllerConfigIdsRef.current.has(3)).toBe(false);
    expect(options.establishingTerminalsRef.current.size).toBe(0);
    expect(syncOpenTmuxSessions).toHaveBeenCalled();
  });
});
