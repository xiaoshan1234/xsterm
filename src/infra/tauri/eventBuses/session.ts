/**
 * Tauri-backed implementation of `model/session.SessionEventBus`.
 *
 * Wraps the existing `infra/tauri/events/{sessionOutput,
 * sessionClosed}.ts` listeners behind the model-defined
 * `SessionEventBus` interface. The `session-disconnected` event is
 * also routed through here so the SessionModel can observe PTY EOF
 * uniformly.
 *
 * Each `subscribe*()` returns a synchronous `Unsubscribe` callable
 * that the model holds; the underlying Tauri `listen()` is invoked
 * lazily on the first subscriber and torn down when the last one
 * unsubscribes. Mirrors the lifecycle that
 * `infra/tauri/eventBus.ts::infraEventBus` already provides — the
 * SessionEventBus surfaces a smaller, typed surface and removes the
 * need for the model to know event-name strings.
 */
import type {
  SessionEventBus,
  SessionLifecycleHandler,
  SessionOutputHandler,
  Unsubscribe,
} from "../../../model/session/events";
import { subscribeSessionOutput } from "../events/sessionOutput";
import { subscribeSessionClosed } from "../events/sessionClosed";
import { infraEventBus } from "../eventBus";

export const tauriSessionEventBus: SessionEventBus = {
  onOutput(handler: SessionOutputHandler): Unsubscribe {
    let cancelled = false;
    let unlistenTauri: (() => void) | null = null;
    void subscribeSessionOutput((sessionId, data) => {
      if (cancelled) return;
      handler(sessionId, data);
    }).then((un) => {
      if (cancelled) {
        un();
        return;
      }
      unlistenTauri = un;
    });
    return () => {
      cancelled = true;
      if (unlistenTauri) unlistenTauri();
    };
  },

  onClosed(handler: SessionLifecycleHandler): Unsubscribe {
    let cancelled = false;
    let unlistenTauri: (() => void) | null = null;
    void subscribeSessionClosed((sessionId) => {
      if (cancelled) return;
      handler(sessionId);
    }).then((un) => {
      if (cancelled) {
        un();
        return;
      }
      unlistenTauri = un;
    });
    return () => {
      cancelled = true;
      if (unlistenTauri) unlistenTauri();
    };
  },

  // `session-disconnected` shares the generic event-bus channel; the
  // payload is a bare `number` (no Tauri wrapper), so we route it
  // through `infraEventBus` to avoid a second `listen()` handle.
  onDisconnected(handler: SessionLifecycleHandler): Unsubscribe {
    return infraEventBus.subscribe<number>("session-disconnected", (sessionId) =>
      handler(sessionId),
    );
  },
};
