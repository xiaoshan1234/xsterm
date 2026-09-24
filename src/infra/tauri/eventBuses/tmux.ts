/**
 * Tauri-backed implementation of `model/tmux.TmuxEventBus`.
 *
 * Wraps the existing `infra/tauri/events/tmuxEvents.ts` and
 * `infra/tauri/events/autoAttach.ts` listeners behind the
 * model-defined `TmuxEventBus` interface.
 *
 * Each `subscribe*()` returns a synchronous `Unsubscribe` callable;
 * the underlying Tauri `listen()` is invoked lazily on the first
 * subscriber and torn down when the last one unsubscribes.
 */
import type {
  AutoAttachOutcomeHandler,
  TmuxContinuedHandler,
  TmuxControllerExitHandler,
  TmuxEventBus,
  TmuxPaneAddedHandler,
  TmuxPaneRemovedHandler,
  TmuxPausedHandler,
  TmuxWindowAddedHandler,
  TmuxWindowClosedHandler,
  TmuxWindowListHandler,
  TmuxWindowRenamedHandler,
  Unsubscribe,
} from "../../../model/tmux/events";
import {
  subscribeTmuxControllerExit,
  subscribeTmuxContinued,
  subscribeTmuxPaneAdded,
  subscribeTmuxPaneRemoved,
  subscribeTmuxPaused,
  subscribeTmuxWindowAdded,
  subscribeTmuxWindowClosed,
  subscribeTmuxWindowList,
  subscribeTmuxWindowRenamed,
} from "../events/tmuxEvents";
import { subscribeAutoAttachOutcome } from "../events/autoAttach";

/** Internal helper: wrap a Tauri `Promise<UnlistenFn>` subscriber in a
 * synchronous `Unsubscribe` callable. The returned closure is
 * idempotent — calling it twice is a no-op. */
function bridge(start: (handler: (unlisten: (() => void) | null) => void) => void): Unsubscribe {
  let unlistenTauri: (() => void) | null = null;
  let cancelled = false;
  start((un) => {
    if (cancelled) {
      if (un) un();
      return;
    }
    unlistenTauri = un;
  });
  return () => {
    if (cancelled) return;
    cancelled = true;
    if (unlistenTauri) unlistenTauri();
  };
}

export const tauriTmuxEventBus: TmuxEventBus = {
  onPaneAdded(handler: TmuxPaneAddedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxPaneAdded((event) => handler(event)).then((un) => register(un));
    });
  },

  onPaneRemoved(handler: TmuxPaneRemovedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxPaneRemoved((event) => handler(event)).then((un) => register(un));
    });
  },

  onWindowAdded(handler: TmuxWindowAddedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxWindowAdded((event) => handler(event)).then((un) => register(un));
    });
  },

  onWindowClosed(handler: TmuxWindowClosedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxWindowClosed((event) => handler(event)).then((un) => register(un));
    });
  },

  onWindowRenamed(handler: TmuxWindowRenamedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxWindowRenamed((event) => handler(event)).then((un) => register(un));
    });
  },

  onWindowList(handler: TmuxWindowListHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxWindowList((controllerId, entries) => handler(controllerId, entries)).then(
        (un) => register(un),
      );
    });
  },

  onControllerExit(handler: TmuxControllerExitHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxControllerExit((event) => handler(event)).then((un) => register(un));
    });
  },

  onPaused(handler: TmuxPausedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxPaused((event) => handler(event)).then((un) => register(un));
    });
  },

  onContinued(handler: TmuxContinuedHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeTmuxContinued((event) => handler(event)).then((un) => register(un));
    });
  },

  onAutoAttachOutcome(handler: AutoAttachOutcomeHandler): Unsubscribe {
    return bridge((register) => {
      void subscribeAutoAttachOutcome((outcome) => handler(outcome)).then((un) => register(un));
    });
  },
};
