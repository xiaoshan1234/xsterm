import { describe, expect, it } from "vitest";
import {
  toBackendTerminalHandle,
  type BackendTerminalHandle,
} from "../../terminal/infrastructure/handles";
import { type TerminalInfoDto } from "../../terminal/infrastructure/tauriContracts";
import { toBackendControllerHandle, toBackendWindowHandle } from "./handles";
import { createTmuxCommandClient } from "./tmuxCommands";

interface InvokeCall {
  command: string;
  args?: Record<string, unknown>;
}

function createInvokeSpy() {
  const calls: InvokeCall[] = [];
  const invokeFunction = async <Value>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<Value> => {
    calls.push({ command, args });
    if (
      command === "attach_tmux_session" ||
      command === "create_tmux_pane" ||
      command === "create_tmux_window"
    ) {
      return createTmuxTerminalInfo() as Value;
    }
    return undefined as Value;
  };
  return { calls, invokeFunction };
}

function createTmuxTerminalInfo(): TerminalInfoDto {
  return {
    id: toBackendTerminalHandle(8),
    name: "tmux:1:%1",
    kind: {
      type: "tmux-pane",
      sessionId: 3,
      paneId: "%1",
    },
    isConnected: true,
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
      supportsMultiplex: true,
    },
  };
}

describe("tmuxCommands", () => {
  it("uses backend xstermSessionId for pane capture and kill", async () => {
    const { calls, invokeFunction } = createInvokeSpy();
    const client = createTmuxCommandClient(invokeFunction);
    const terminalHandle = toBackendTerminalHandle(8);

    await client.captureTmuxPane(terminalHandle, 200);
    await client.killTmuxPane(terminalHandle);

    expect(calls).toEqual([
      {
        command: "capture_tmux_pane",
        args: { xstermSessionId: terminalHandle, lines: 200 },
      },
      {
        command: "kill_tmux_pane",
        args: { xstermSessionId: terminalHandle },
      },
    ]);
  });

  it("keeps controller, parent terminal, and window handles distinct", async () => {
    const { calls, invokeFunction } = createInvokeSpy();
    const client = createTmuxCommandClient(invokeFunction);
    const controllerHandle = toBackendControllerHandle(3);
    const parentTerminalHandle: BackendTerminalHandle = toBackendTerminalHandle(8);
    const windowHandle = toBackendWindowHandle(12);

    await client.createTmuxPane(controllerHandle, parentTerminalHandle, "vertical");
    await client.renameTmuxWindow(windowHandle, "server");

    expect(calls).toEqual([
      {
        command: "create_tmux_pane",
        args: {
          controllerId: controllerHandle,
          parentXstermSessionId: parentTerminalHandle,
          direction: "vertical",
        },
      },
      {
        command: "rename_tmux_window",
        args: {
          xstermWindowId: windowHandle,
          name: "server",
        },
      },
    ]);
  });
});
