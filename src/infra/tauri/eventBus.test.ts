/**
 * Smoke test for the generic infra event bus.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInfraEventBus } from "./eventBus";

let callCount: (eventName: string) => void;
let handlers: Map<string, Array<(e: { payload: unknown }) => void>>;
let unlisten: () => void;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: (e: { payload: unknown }) => void): Promise<() => void> => {
    callCount(eventName);
    const eventListeners = handlers.get(eventName) ?? [];
    eventListeners.push(handler);
    handlers.set(eventName, eventListeners);
    return Promise.resolve(unlisten);
  },
}));

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  callCount = vi.fn() as unknown as (eventName: string) => void;
  unlisten = vi.fn() as unknown as () => void;
  handlers = new Map();
});

describe("createInfraEventBus", () => {
  it("fans out payload to all subscribers", async () => {
    const bus = createInfraEventBus();
    const gotList: number[] = [];
    bus.subscribe<number>("session-output", (id) => gotList.push(id));
    bus.subscribe<number>("session-output", (id) => gotList.push(id + 100));
    await flush();
    expect(callCount).toHaveBeenCalledTimes(1);
    expect(callCount).toHaveBeenCalledWith("session-output");
    const h = handlers.get("session-output")![0]!;
    h({ payload: 42 });
    expect(gotList).toEqual([42, 142]);
  });

  it("shares the underlying listen across subscribers on the same event", async () => {
    const bus = createInfraEventBus();
    bus.subscribe("evt", () => {});
    await flush();
    bus.subscribe("evt", () => {});
    bus.subscribe("evt", () => {});
    await flush();
    expect(callCount).toHaveBeenCalledTimes(1);
  });

  it("calls unlisten when the last subscriber unsubscribes", async () => {
    const bus = createInfraEventBus();
    const off1 = bus.subscribe("evt", () => {});
    const off2 = bus.subscribe("evt", () => {});
    await flush();
    off1();
    expect(unlisten).not.toHaveBeenCalled();
    off2();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
