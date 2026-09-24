/**
 * `useSessionModel` — React hook that owns the `SessionModel` lifecycle.
 *
 * **Pattern**: factory + per-tree instance. The model is stateful and
 * subscribes to the Tauri event bus on construction, so it must be
 * created inside the React tree (not as a module-level singleton —
 * that would break HMR + strict-mode double-mount).
 *
 * **Strict-mode safety**: React 18 strict-mode mounts the component
 * twice on the first render. `useRef` caches the model across both
 * mounts; the cleanup function disposes it once on the final unmount.
 *
 * **Hydration**: this hook does NOT call `hydrate()` automatically.
 * The host (`App.tsx`) decides when to hydrate — typically inside a
 * `useEffect(() => void sessionModel.hydrate(), [])` immediately after
 * the model is obtained.
 */
import { useEffect, useRef } from "react";
import { tauriSessionEventBus } from "../../infra/tauri/eventBuses/session";
import { tauriSessionRepository } from "../../infra/tauri/repositories/sessions";
import { createSessionModel, type SessionModel, type SessionModelDeps } from "./model";

/**
 * Construct (or reuse) the `SessionModel` for the current React tree.
 *
 * `deps` is optional; if omitted, the model is wired with the default
 * Tauri `SessionRepository` + `SessionEventBus`. Tests can pass an
 * alternative `deps` to inject fakes.
 *
 * Only fields actually provided are forwarded — the host (App.tsx)
 * typically only needs `onSessionClosed`.
 */
export function useSessionModel(deps?: Partial<SessionModelDeps>): SessionModel {
  const modelRef = useRef<SessionModel | null>(null);

  if (modelRef.current === null) {
    modelRef.current = createSessionModel({
      repo: deps?.repo ?? tauriSessionRepository,
      bus: deps?.bus ?? tauriSessionEventBus,
      onSessionClosed: deps?.onSessionClosed,
    });
  }

  useEffect(() => {
    const model = modelRef.current;
    return () => {
      if (model) {
        model.dispose();
        modelRef.current = null;
      }
    };
  }, []);

  return modelRef.current;
}
