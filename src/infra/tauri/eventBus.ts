/**
 * Generic event bus abstraction over `@tauri-apps/api/event::listen`.
 *
 * Used as a single point of dispatch from infra → service. Domain
 * subscribers (in the service / app layer) call
 * `infraEventBus.subscribe("session-output", handler)` instead of
 * calling `listen()` directly, which keeps the service layer free of
 * `@tauri-apps/api/*` imports.
 *
 * The bus lazily calls `listen()` on the first subscriber for a given
 * event name, fans the payload out to every registered handler, and
 * cleans up the underlying `listen()` handle once the last subscriber
 * unsubscribes.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type EventHandler<T> = (payload: T) => void;

export interface InfraEventBus {
  subscribe<T>(eventName: string, handler: EventHandler<T>): () => void;
}

export function createInfraEventBus(): InfraEventBus {
  const handlers = new Map<string, Set<EventHandler<unknown>>>();
  const unsubscribers = new Map<string, UnlistenFn>();

  // Track in-flight listen() Promises so concurrent subscribe() calls
  // don't race the `.then(...)` that registers the unlistener.
  const pending = new Map<string, Promise<UnlistenFn>>();

  function ensureListening(eventName: string): Promise<UnlistenFn> | undefined {
    if (unsubscribers.has(eventName)) return undefined;
    if (pending.has(eventName)) return pending.get(eventName);
    const p = listen(eventName, (event) => {
      const set = handlers.get(eventName);
      if (!set) return;
      for (const h of set) h(event.payload);
    }).then((un) => {
      unsubscribers.set(eventName, un);
      pending.delete(eventName);
      return un;
    });
    pending.set(eventName, p);
    return p;
  }

  return {
    subscribe<T>(eventName: string, handler: EventHandler<T>): () => void {
      ensureListening(eventName);
      let set = handlers.get(eventName);
      if (!set) {
        set = new Set();
        handlers.set(eventName, set);
      }
      set.add(handler as EventHandler<unknown>);
      return () => {
        set!.delete(handler as EventHandler<unknown>);
        if (set!.size === 0) {
          const un = unsubscribers.get(eventName);
          if (un) {
            un();
            unsubscribers.delete(eventName);
          }
        }
      };
    },
  };
}

/**
 * Process-wide default bus. Service-layer subscribers call
 * `infraEventBus.subscribe(...)` instead of creating their own bus.
 */
export const infraEventBus: InfraEventBus = createInfraEventBus();
