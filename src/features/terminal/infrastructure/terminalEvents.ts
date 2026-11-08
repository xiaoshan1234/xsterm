import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toBackendTerminalHandle } from "./handles";
import {
  type TerminalClosedEvent,
  type TerminalDisconnectedEvent,
  type TerminalOutputEvent,
} from "./tauriContracts";

type ListenFunction = <Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
) => Promise<UnlistenFn>;

export interface TerminalEventHandlers {
  onOutput?: (event: TerminalOutputEvent) => void;
  onDisconnected?: (event: TerminalDisconnectedEvent) => void;
  onClosed?: (event: TerminalClosedEvent) => void;
}

type RawTerminalOutputPayload = readonly [number, readonly number[]];

export async function subscribeTerminalEvents(
  handlers: TerminalEventHandlers,
  listenFunction: ListenFunction = defaultListen,
): Promise<UnlistenFn> {
  const subscriptions: Array<Promise<UnlistenFn>> = [];

  if (handlers.onOutput) {
    subscriptions.push(
      listenFunction<RawTerminalOutputPayload>("terminal-output", (payload) => {
        handlers.onOutput?.(normalizeTerminalOutput(payload));
      }),
    );
  }
  if (handlers.onDisconnected) {
    subscriptions.push(
      listenFunction<number>("terminal-disconnected", (terminalHandle) => {
        handlers.onDisconnected?.({
          terminalHandle: toBackendTerminalHandle(terminalHandle),
        });
      }),
    );
  }
  if (handlers.onClosed) {
    subscriptions.push(
      listenFunction<number>("terminal-closed", (terminalHandle) => {
        handlers.onClosed?.({
          terminalHandle: toBackendTerminalHandle(terminalHandle),
        });
      }),
    );
  }

  try {
    const unlisteners = await Promise.all(subscriptions);
    return () => {
      for (const unlisten of unlisteners) unlisten();
    };
  } catch (error) {
    const settled = await Promise.allSettled(subscriptions);
    for (const result of settled) {
      if (result.status === "fulfilled") result.value();
    }
    throw error;
  }
}

export function normalizeTerminalOutput(payload: RawTerminalOutputPayload): TerminalOutputEvent {
  if (!Array.isArray(payload) || payload.length !== 2) {
    throw new Error("Invalid terminal-output payload");
  }
  const [terminalHandle, bytes] = payload;
  if (!Array.isArray(bytes)) {
    throw new Error("Invalid terminal-output data");
  }

  return {
    terminalHandle: toBackendTerminalHandle(terminalHandle),
    data: new Uint8Array(bytes),
  };
}

async function defaultListen<Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
): Promise<UnlistenFn> {
  return listen<Payload>(eventName, (event) => handler(event.payload));
}
