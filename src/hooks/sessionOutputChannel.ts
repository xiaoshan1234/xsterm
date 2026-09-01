import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { parseSessionOutputFrame } from "./sessionOutputFrame";

/**
 * Singleton Tauri `Channel<Uint8Array>` carrying raw `session-output`
 * frames (Perf 001). The Rust side emits the channel via the
 * `get_session_output_channel` command once at app startup; this module
 * fetches and caches it on first use, then dispatches incoming frames to
 * per-session listeners registered via `onSessionOutput`.
 *
 * Why a singleton: there is exactly one PTY output stream for the whole
 * app. Per-terminal listeners would just duplicate dispatch logic. The
 * single channel + per-session callback map lets every Terminal component
 * subscribe cheaply without each one round-tripping to Rust.
 */

const GET_SESSION_OUTPUT_CHANNEL_CMD = "get_session_output_channel";

let cachedChannel: Channel<Uint8Array> | null = null;
const sessionListeners = new Map<number, Set<(data: Uint8Array) => void>>();
let channelSetupPromise: Promise<Channel<Uint8Array>> | null = null;

function setupChannelHandlers(channel: Channel<Uint8Array>): void {
  channel.onmessage = (frame: Uint8Array) => {
    const parsed = parseSessionOutputFrame(frame);
    if (!parsed) return;
    const listeners = sessionListeners.get(parsed.sessionId);
    if (!listeners || listeners.size === 0) return;
    for (const cb of listeners) {
      cb(parsed.data);
    }
  };
}

export function getSessionOutputChannel(): Promise<Channel<Uint8Array>> {
  if (cachedChannel) return Promise.resolve(cachedChannel);
  if (!channelSetupPromise) {
    channelSetupPromise = invoke<Channel<Uint8Array>>(GET_SESSION_OUTPUT_CHANNEL_CMD).then(
      (channel) => {
        cachedChannel = channel;
        setupChannelHandlers(channel);
        return channel;
      },
    );
  }
  return channelSetupPromise;
}

export function onSessionOutput(
  sessionId: number,
  callback: (data: Uint8Array) => void,
): () => void {
  let set = sessionListeners.get(sessionId);
  if (!set) {
    set = new Set();
    sessionListeners.set(sessionId, set);
  }
  set.add(callback);
  return () => {
    set.delete(callback);
    if (set.size === 0) sessionListeners.delete(sessionId);
  };
}