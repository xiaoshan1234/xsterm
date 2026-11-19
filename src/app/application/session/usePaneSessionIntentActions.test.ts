/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "../../../features/terminal";
import type { PaneIntentActions } from "../../../features/workspace";
import {
  type PaneSessionIntentPorts,
  usePaneSessionIntentActions,
} from "./usePaneSessionIntentActions";

function createTerminal(): Terminal {
  return {
    id: 7,
    configId: "config-1",
    name: "Terminal",
    type: "local",
    isConnected: true,
    kind: {
      type: "local",
      shell: "pwsh",
      cwd: "C:\\",
    },
  };
}

function createActionPorts() {
  return {
    closeTerminal: vi.fn(async () => undefined),
    createTerminalFromSavedConfig: vi.fn(async () => createTerminal()),
    createLocalSessionOnly: vi.fn(async () => createTerminal()),
    createSshSessionOnly: vi.fn(async () => createTerminal()),
    replaceInitWindowWithTerminal: vi.fn(),
  } satisfies PaneSessionIntentPorts;
}

function createWorkspaceIntents() {
  return {
    attachExistingTerminal: vi.fn(async () => undefined),
    splitPaneWithTerminal: vi.fn(async () => undefined),
  } satisfies Pick<PaneIntentActions, "attachExistingTerminal" | "splitPaneWithTerminal">;
}

describe("usePaneSessionIntentActions", () => {
  it("creates a saved-config terminal and delegates the workspace split", async () => {
    const actions = createActionPorts();
    const workspaceIntents = createWorkspaceIntents();
    const { result } = renderHook(() => usePaneSessionIntentActions({ actions, workspaceIntents }));

    await act(() =>
      result.current.splitPaneWithSavedConfig({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: "pane-1",
        direction: "vertical",
        configId: "saved-config",
      }),
    );

    expect(actions.createTerminalFromSavedConfig).toHaveBeenCalledWith("saved-config");
    expect(workspaceIntents.splitPaneWithTerminal).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      windowId: "window-1",
      paneId: "pane-1",
      direction: "vertical",
      terminalId: 7,
      configId: "config-1",
    });
  });

  it("closes the newly created terminal when attaching it to the pane fails", async () => {
    const actions = createActionPorts();
    const workspaceIntents = createWorkspaceIntents();
    workspaceIntents.attachExistingTerminal.mockRejectedValueOnce(new Error("attach failed"));
    const { result } = renderHook(() => usePaneSessionIntentActions({ actions, workspaceIntents }));

    await expect(
      result.current.attachSavedConfigToPane({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: "pane-1",
        configId: "saved-config",
      }),
    ).rejects.toThrow("attach failed");

    expect(actions.closeTerminal).toHaveBeenCalledWith(7);
  });

  it("uses the SSH target as the window name when no explicit name is supplied", async () => {
    const actions = createActionPorts();
    const workspaceIntents = createWorkspaceIntents();
    const { result } = renderHook(() => usePaneSessionIntentActions({ actions, workspaceIntents }));

    await act(() =>
      result.current.createSshTerminalForWindow({
        workspaceId: "workspace-1",
        windowId: "window-1",
        config: {
          host: "example.com",
          port: 22,
          username: "dev",
          authType: "password",
        },
      }),
    );

    expect(actions.replaceInitWindowWithTerminal).toHaveBeenCalledWith(
      "workspace-1",
      "window-1",
      expect.objectContaining({ name: "dev@example.com" }),
    );
  });
});
