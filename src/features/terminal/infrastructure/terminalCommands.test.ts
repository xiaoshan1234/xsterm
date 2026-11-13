import { describe, expect, it } from "vitest";
import { toBackendTerminalHandle } from "./handles";
import { createTerminalCommandClient } from "./terminalCommands";
import { type TerminalInfoDto } from "./tauriContracts";

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
    if (command === "list_terminals") {
      return [createTerminalInfo()] as Value;
    }
    if (command.includes("terminal") && command !== "write_terminal") {
      return createTerminalInfo() as Value;
    }
    return undefined as Value;
  };
  return { calls, invokeFunction };
}

function createTerminalInfo(): TerminalInfoDto {
  return {
    id: toBackendTerminalHandle(7),
    name: "Local",
    kind: {
      type: "local",
      shell: "powershell.exe",
      cwd: "C:\\",
    },
    isConnected: true,
    capabilities: {
      supportsResize: true,
      supportsReconnect: false,
      supportsLocalEcho: true,
      supportsMultiplex: false,
    },
  };
}

describe("terminalCommands", () => {
  it("maps backend session_id parameters to the wire sessionId field", async () => {
    const { calls, invokeFunction } = createInvokeSpy();
    const client = createTerminalCommandClient(invokeFunction);
    const handle = toBackendTerminalHandle(7);
    const data = new Uint8Array([65, 66]);

    await client.writeTerminal(handle, data);
    await client.resizeTerminal(handle, 24, 80);
    await client.closeTerminal(handle);
    await client.uploadImageToSshTerminal(handle, "image.png", data);

    expect(calls).toEqual([
      {
        command: "write_terminal",
        args: { sessionId: handle, data },
      },
      {
        command: "resize_terminal",
        args: { sessionId: handle, rows: 24, cols: 80 },
      },
      {
        command: "close_terminal",
        args: { sessionId: handle },
      },
      {
        command: "upload_image_to_ssh_terminal",
        args: { sessionId: handle, filename: "image.png", data },
      },
    ]);
  });

  it("serializes writes for the same terminal to preserve keystroke order", async () => {
    const writes: number[][] = [];
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const invokeFunction = async <Value>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<Value> => {
      if (command === "write_terminal") {
        const data = args?.data as Uint8Array;
        writes.push([...data]);
        if (writes.length === 1) await firstWriteGate;
      }
      return undefined as Value;
    };
    const client = createTerminalCommandClient(invokeFunction);
    const handle = toBackendTerminalHandle(7);

    const first = client.writeTerminal(handle, new Uint8Array([65]));
    const second = client.writeTerminal(handle, new Uint8Array([32]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toEqual([[65]]);
    releaseFirstWrite?.();
    await Promise.all([first, second]);
    expect(writes).toEqual([[65], [32]]);
  });
});
