import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Channel, invoke } from "@tauri-apps/api/core";
import { toBackendTerminalHandle } from "./handles";
import { type TerminalClosedEvent, type TerminalDisconnectedEvent } from "./tauriContracts";

type ListenFunction = <Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
) => Promise<UnlistenFn>;

export type InvokeFunction = <Value>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<Value>;

export interface TerminalEventHandlers {
  onDisconnected?: (event: TerminalDisconnectedEvent) => void;
  onClosed?: (event: TerminalClosedEvent) => void;
}

export async function subscribeTerminalEvents(
  handlers: TerminalEventHandlers,
  listenFunction: ListenFunction = defaultListen,
): Promise<UnlistenFn> {
  const subscriptions: Array<Promise<UnlistenFn>> = [];

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

/**
 * Subscribe one terminal to its raw output stream.
 *
 * The frontend creates a Tauri `Channel` and hands it to the backend; the
 * backend pushes raw bytes through it, which the WebView receives as an
 * `ArrayBuffer` with no JSON byte-array round-trip. The returned function
 * unsubscribes so the backend can stop routing this session's bytes.
 */
export async function subscribeTerminalOutput(
  sessionId: number,
  onOutput: (data: Uint8Array) => void,
  invokeFunction: InvokeFunction = defaultInvoke,
  channelFactory: () => Channel<ArrayBuffer> = () => new Channel<ArrayBuffer>(),
): Promise<() => void> {
  const channel = channelFactory();
  channel.onmessage = (message) => {
    onOutput(new Uint8Array(message));
  };

  const subscriptionId = await invokeFunction<number>("subscribe_terminal_output", {
    sessionId,
    channel,
  });

  return () => {
    invokeFunction<void>("unsubscribe_terminal_output", {
      sessionId,
      subscriptionId,
    }).catch(() => {
      // Best-effort: the channel is torn down with the webview on unload.
    });
  };
}

async function defaultListen<Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
): Promise<UnlistenFn> {
  return listen<Payload>(eventName, (event) => handler(event.payload));
}

async function defaultInvoke<Value>(
  command: string,
  args?: Record<string, unknown>,
): Promise<Value> {
  return invoke<Value>(command, args);
}
