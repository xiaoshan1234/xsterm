/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isApplicationError } from "../../../models/applicationError";
import { type Terminal } from "../../../models/terminal/runtimeContracts";
import { type EditablePaneNode } from "../../../models/workspace/EditablePaneTree";
import { type Workspace } from "../../../models/workspace/EditableWorkspace";
import { type SessionActions, type TerminalState } from "./types";
import { usePaneIntentActions } from "./usePaneIntentActions";

const targetPane: EditablePaneNode = {
  id: "target-pane",
  type: "leaf",
  size: 100,
};

function createWorkspace(terminalId?: number): Workspace {
  return {
    id: "workspace-1",
    name: "workspace",
    activeWindowId: "window-1",
    terminalIds: terminalId === undefined ? [] : [terminalId],
    windows: [
      {
        id: "window-1",
        name: "window",
        activePaneId: targetPane.id,
        rootPane:
          terminalId === undefined
            ? targetPane
            : {
                ...targetPane,
                terminalId,
                configId: "config-1",
              },
      },
    ],
  };
}

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
    closePane: vi.fn(async () => undefined),
    closeTerminal: vi.fn(async () => undefined),
    createTerminalFromSavedConfig: vi.fn(async () => createTerminal()),
    setActivePane: vi.fn(),
    setActiveWorkspace: vi.fn(),
    splitPane: vi.fn(),
    updateWindowPaneTree: vi.fn(),
  } satisfies Pick<
    SessionActions,
    | "closePane"
    | "closeTerminal"
    | "createTerminalFromSavedConfig"
    | "setActivePane"
    | "setActiveWorkspace"
    | "splitPane"
    | "updateWindowPaneTree"
  >;
}

describe("usePaneIntentActions", () => {
  it("attaches an existing terminal and activates its pane", async () => {
    const actions = createActionPorts();
    const state = {
      terminals: [createTerminal()],
      workspaces: [createWorkspace()],
    } satisfies Pick<TerminalState, "terminals" | "workspaces">;
    const { result } = renderHook(() => usePaneIntentActions({ state, actions }));

    await act(() =>
      result.current.attachExistingTerminal({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: targetPane.id,
        terminalId: 7,
      }),
    );

    expect(actions.updateWindowPaneTree).toHaveBeenCalledWith(
      "workspace-1",
      "window-1",
      expect.any(Function),
    );
    const update = actions.updateWindowPaneTree.mock.calls[0][2];
    expect(update(targetPane)).toMatchObject({ terminalId: 7, configId: "config-1" });
    expect(actions.setActiveWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(actions.setActivePane).toHaveBeenCalledWith("workspace-1", "window-1", targetPane.id);
  });

  it("rejects attaching a terminal already used by another window", async () => {
    const actions = createActionPorts();
    const occupied = createWorkspace();
    occupied.terminalIds = [7];
    occupied.windows.push({
      id: "window-2",
      name: "other",
      activePaneId: "other-pane",
      rootPane: {
        id: "other-pane",
        type: "leaf",
        size: 100,
        terminalId: 7,
        configId: "config-1",
      },
    });
    const state = {
      terminals: [createTerminal()],
      workspaces: [occupied],
    } satisfies Pick<TerminalState, "terminals" | "workspaces">;
    const { result } = renderHook(() => usePaneIntentActions({ state, actions }));

    let error: unknown;
    try {
      await result.current.attachExistingTerminal({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: targetPane.id,
        terminalId: 7,
      });
    } catch (cause) {
      error = cause;
    }

    expect(isApplicationError(error, "terminal-already-attached")).toBe(true);
    expect(actions.updateWindowPaneTree).not.toHaveBeenCalled();
  });

  it("creates a saved-config terminal and splits the target pane", async () => {
    const actions = createActionPorts();
    const state = {
      terminals: [],
      workspaces: [createWorkspace()],
    } satisfies Pick<TerminalState, "terminals" | "workspaces">;
    const { result } = renderHook(() => usePaneIntentActions({ state, actions }));

    await act(() =>
      result.current.splitPaneWithSavedConfig({
        workspaceId: "workspace-1",
        windowId: "window-1",
        paneId: targetPane.id,
        direction: "vertical",
        configId: "saved-config",
      }),
    );

    expect(actions.createTerminalFromSavedConfig).toHaveBeenCalledWith("saved-config");
    expect(actions.splitPane).toHaveBeenCalledWith(
      "workspace-1",
      "window-1",
      targetPane.id,
      "vertical",
      7,
      "config-1",
    );
  });
});
