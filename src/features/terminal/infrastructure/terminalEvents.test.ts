import { describe, expect, it, vi } from "vitest";
import { toBackendTerminalHandle } from "./handles";
import { normalizeTerminalOutput, subscribeTerminalEvents } from "./terminalEvents";

describe("terminal events", () => {
  it("normalizes stdout JSON byte arrays into Uint8Array", () => {
    const event = normalizeTerminalOutput([7, [65, 66]]);

    expect(event.terminalHandle).toBe(toBackendTerminalHandle(7));
    expect([...event.data]).toEqual([65, 66]);
  });

  it("subscribes with the backend event names and cleans up", async () => {
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
});
