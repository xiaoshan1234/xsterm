import { describe, expect, it, vi } from "vitest";
import { type Channel } from "@tauri-apps/api/core";
import { toBackendTerminalHandle } from "./handles";
import {
  subscribeTerminalEvents,
  subscribeTerminalOutput,
  type InvokeFunction,
} from "./terminalEvents";

describe("terminal events", () => {
  it("subscribes to lifecycle events and cleans up", async () => {
    const unlisteners = new Map<string, ReturnType<typeof vi.fn>>();
    const listenFunction = async <Payload>(
      eventName: string,
      handler: (payload: Payload) => void,
    ) => {
      const unlisten = vi.fn();
      unlisteners.set(eventName, unlisten);
      if (eventName === "terminal-disconnected") {
        handler(7 as Payload);
      }
      return unlisten;
    };
    const onDisconnected = vi.fn();
    const cleanup = await subscribeTerminalEvents({ onDisconnected }, listenFunction);

    expect(onDisconnected).toHaveBeenCalledWith({
      terminalHandle: toBackendTerminalHandle(7),
    });
    cleanup();
    expect(unlisteners.get("terminal-disconnected")).toHaveBeenCalledOnce();
  });

  it("subscribes a raw output channel and converts ArrayBuffer to Uint8Array", async () => {
    const fakeChannel = {
      onmessage: null as ((message: ArrayBuffer) => void) | null,
    };
    const invokeFunction = vi.fn(async (command: string) =>
      command === "subscribe_terminal_output" ? 42 : undefined,
    ) as unknown as InvokeFunction;
    const onOutput = vi.fn();

    const cleanup = await subscribeTerminalOutput(
      7,
      onOutput,
      invokeFunction,
      () => fakeChannel as unknown as Channel<ArrayBuffer>,
    );

    expect(invokeFunction).toHaveBeenCalledWith("subscribe_terminal_output", {
      sessionId: 7,
      channel: fakeChannel,
    });

    const buffer = new Uint8Array([65, 66, 67]).buffer;
    fakeChannel.onmessage?.(buffer);
    expect(onOutput).toHaveBeenCalledOnce();
    expect([...(onOutput.mock.calls[0][0] as Uint8Array)]).toEqual([65, 66, 67]);

    cleanup();
    await Promise.resolve();
    expect(invokeFunction).toHaveBeenCalledWith("unsubscribe_terminal_output", {
      sessionId: 7,
      subscriptionId: 42,
    });
  });
});
