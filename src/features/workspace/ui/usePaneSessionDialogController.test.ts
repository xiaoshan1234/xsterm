/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Terminal } from "../../terminal";
import { usePaneSessionDialogController } from "./usePaneSessionDialogController";

const workspaceId = createWorkspaceId("workspace-1");
const windowId = createWindowId("window-1");
const paneId = createPaneId("pane-1");

function createTerminal(supportsMultiplex = false): Terminal {
  return {
    id: createTerminalId(7),
    configId: "config-1",
    name: "Terminal",
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: true,
      supportsMultiplex,
    },
  };
}

function createController(kind: "regular" | "multiplexed") {
  const terminal = createTerminal(kind === "multiplexed");
  const paneIntents = {
    attachExistingTerminal: vi.fn(async () => undefined),
    splitPaneWithTerminal: vi.fn(async () => undefined),
  };
  const paneSessionIntents = {
    attachSavedConfigToPane: vi.fn(async () => undefined),
    splitPaneWithSavedConfig: vi.fn(async () => undefined),
  };
  const reportError = vi.fn();
  const hook = renderHook(() =>
    usePaneSessionDialogController({
      workspaceId,
      windowId,
      paneId,
      terminal,
      paneTerminalId: terminal.id,
      paneConfigId: terminal.configId,
      terminals: [terminal],
      paneIntents,
      paneSessionIntents,
      reportError,
    }),
  );
  return { hook, paneIntents, paneSessionIntents, reportError, terminal };
}

describe("usePaneSessionDialogController", () => {
  it("splits multiplexed terminals immediately", () => {
    const { hook, paneIntents } = createController("multiplexed");

    act(() => hook.result.current.startSplit("vertical"));

    expect(paneIntents.splitPaneWithTerminal).toHaveBeenCalledWith({
      workspaceId,
      windowId,
      paneId,
      direction: "vertical",
      terminalId: createTerminalId(7),
      configId: "config-1",
    });
    expect(hook.result.current.showSessionDialog).toBe(false);
  });

  it("uses the dialog flow for regular terminals", async () => {
    const { hook, paneIntents } = createController("regular");

    act(() => hook.result.current.startSplit("horizontal"));
    expect(hook.result.current.showSessionDialog).toBe(true);

    await act(() => hook.result.current.selectSession(createTerminalId(7)));

    expect(paneIntents.splitPaneWithTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        windowId,
        paneId,
        direction: "horizontal",
        terminalId: createTerminalId(7),
        configId: "config-1",
      }),
    );
    expect(hook.result.current.showSessionDialog).toBe(false);
  });

  it("attaches a saved config through the session intent port", async () => {
    const { hook, paneSessionIntents } = createController("regular");

    act(() => hook.result.current.startAttach());
    await act(() => hook.result.current.selectConfig("saved-config"));

    expect(paneSessionIntents.attachSavedConfigToPane).toHaveBeenCalledWith({
      workspaceId,
      windowId,
      paneId,
      configId: "saved-config",
    });
  });
});
