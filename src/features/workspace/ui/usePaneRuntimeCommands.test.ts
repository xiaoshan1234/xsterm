/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Terminal } from "../../terminal";
import type { Window } from "../contracts";
import { usePaneRuntimeCommands } from "./usePaneRuntimeCommands";

const terminal: Terminal = {
  id: createTerminalId(7),
  configId: "config-1",
  name: "tmux",
  type: "tmux-pane",
  isConnected: true,
  kind: { type: "tmux-pane", sessionId: 3, paneId: "%1" },
  tmux: { controllerId: 3, paneId: "%1", windowId: "@1" },
};

const selectedWindow: Window = {
  id: createWindowId("window-1"),
  name: "tmux",
  rootPane: { id: createPaneId("pane-1"), type: "leaf", size: 100, terminalId: terminal.id },
  activePaneId: createPaneId("pane-1"),
  xstermWindowId: 42,
};

function createCommands() {
  const paneIntents = {
    closePane: vi.fn(async () => undefined),
    closeTerminal: vi.fn(async () => undefined),
  };
  const paneRuntimeActions = {
    createMultiplexedWindow: vi.fn(async () => undefined),
    closeMultiplexedWindow: vi.fn(async () => undefined),
    renameMultiplexedWindow: vi.fn(async () => undefined),
  };
  const reportError = vi.fn();
  const hook = renderHook(() =>
    usePaneRuntimeCommands({
      workspaceId: createWorkspaceId("workspace-1"),
      windowId: selectedWindow.id,
      paneId: createPaneId("pane-1"),
      terminal,
      selectedWindow,
      paneIntents,
      paneRuntimeActions,
      reportError,
    }),
  );
  return { hook, paneIntents, paneRuntimeActions, reportError };
}

describe("usePaneRuntimeCommands", () => {
  it("delegates pane and terminal closing", () => {
    const { hook, paneIntents } = createCommands();

    act(() => hook.result.current.closeTerminal());
    act(() => hook.result.current.closePane());

    expect(paneIntents.closeTerminal).toHaveBeenCalledWith(terminal.id);
    expect(paneIntents.closePane).toHaveBeenCalledWith({
      workspaceId: createWorkspaceId("workspace-1"),
      windowId: selectedWindow.id,
      paneId: createPaneId("pane-1"),
    });
  });

  it("delegates multiplexed window commands through the injected runtime port", async () => {
    const { hook, paneRuntimeActions } = createCommands();

    await act(() => hook.result.current.createMultiplexedWindow());
    await act(() => hook.result.current.closeMultiplexedWindow());
    await act(() => hook.result.current.renameMultiplexedWindow(" renamed "));

    expect(paneRuntimeActions.createMultiplexedWindow).toHaveBeenCalledWith(terminal.id);
    expect(paneRuntimeActions.closeMultiplexedWindow).toHaveBeenCalledWith(42);
    expect(paneRuntimeActions.renameMultiplexedWindow).toHaveBeenCalledWith(42, "renamed");
  });
});
