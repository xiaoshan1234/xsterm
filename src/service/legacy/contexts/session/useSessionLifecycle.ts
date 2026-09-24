/**
 * Session lifecycle hook — thin wrappers around the use cases in
 * `src/app/useCases/`. The legacy 700-line monolith has been decomposed
 * into one use case per user intent. This hook only exposes them to the
 * rest of the React tree under the legacy `useSessionLifecycle()`
 * surface.
 *
 * **Why this lives**: the `useSessionActions` composition root imports
 * `useSessionLifecycle()` and spreads its return value into the public
 * `SessionActions` shape. Keeping the same export surface means we don't
 * have to touch `useSessionActions.ts` for the lifecycle callbacks.
 *
 * **State + I/O**: every callback now goes through a use case, which
 * reads/writes `service/session/store.ts`, `service/workspace/store.ts`,
 * and `service/persistence/store.ts` synchronously via
 * `store.getState()`.
 */
import { useCallback } from "react";
import { createLocalSession as createLocalSessionUseCase } from "../../../../app/useCases/createLocalSession";
import { createSshSession as createSshSessionUseCase } from "../../../../app/useCases/createSshSession";
import { createLocalSessionOnly as createLocalSessionOnlyUseCase } from "../../../../app/useCases/createLocalSessionOnly";
import { createSshSessionOnly as createSshSessionOnlyUseCase } from "../../../../app/useCases/createSshSessionOnly";
import { createTmuxSession as createTmuxSessionUseCase } from "../../../../app/useCases/createTmuxSession";
import { createTmuxSessionOnly as createTmuxSessionOnlyUseCase } from "../../../../app/useCases/createTmuxSessionOnly";
import { openSavedSession as openSavedSessionUseCase } from "../../../../app/useCases/openSavedSession";
import { closeSession as closeSessionUseCase } from "../../../../app/useCases/closeSession";
import { reconnectSession as reconnectSessionUseCase } from "../../../../app/useCases/reconnectSession";
import { renameSession as renameSessionUseCase } from "../../../../app/useCases/renameSession";
import { applyDisplayConfigToLiveSession as applyDisplayConfigToLiveSessionUseCase } from "../../../../app/useCases/applyDisplayConfigToLiveSession";
import { removeConfig as removeConfigUseCase } from "../../../../app/useCases/removeConfig";
import { saveConfigOnly as saveConfigOnlyUseCase } from "../../../../app/useCases/saveConfigOnly";

interface SessionLifecycleHookDeps {
  /**
   * Legacy hook took a bundle of session/workspace/persistence state plus
   * sub-hook helpers (openFromConfigInternal, createWindowFromSession,
   * etc.). With the use-case decomposition the legacy helpers are no
   * longer needed — the use cases own their state mutations end-to-end.
   * Kept as an empty interface for backwards compatibility with the
   * spread `...opts` call in `useSessionActions.ts`.
   */
  [key: string]: never;
}

export function useSessionLifecycle(_deps: SessionLifecycleHookDeps = {}) {
  // --- create flows ---------------------------------------------------
  const createLocalSession = useCallback(
    (
      config: Parameters<typeof createLocalSessionUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createLocalSessionUseCase>[2],
    ) => createLocalSessionUseCase(config, save, displayConfig),
    [],
  );

  const createSshSession = useCallback(
    (
      config: Parameters<typeof createSshSessionUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createSshSessionUseCase>[2],
    ) => createSshSessionUseCase(config, save, displayConfig),
    [],
  );

  const createLocalSessionOnly = useCallback(
    (
      config: Parameters<typeof createLocalSessionOnlyUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createLocalSessionOnlyUseCase>[2],
    ) => createLocalSessionOnlyUseCase(config, save, displayConfig),
    [],
  );

  const createSshSessionOnly = useCallback(
    (
      config: Parameters<typeof createSshSessionOnlyUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createSshSessionOnlyUseCase>[2],
    ) => createSshSessionOnlyUseCase(config, save, displayConfig),
    [],
  );

  const createTmuxSession = useCallback(
    (
      config: Parameters<typeof createTmuxSessionUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createTmuxSessionUseCase>[2],
    ) => createTmuxSessionUseCase(config, save, displayConfig),
    [],
  );

  const createTmuxSessionOnly = useCallback(
    (
      config: Parameters<typeof createTmuxSessionOnlyUseCase>[0],
      save?: boolean,
      displayConfig?: Parameters<typeof createTmuxSessionOnlyUseCase>[2],
    ) => createTmuxSessionOnlyUseCase(config, save, displayConfig),
    [],
  );

  // --- open / save / remove / rename / close ---------------------------
  const openFromConfig = useCallback((configId: string) => openSavedSessionUseCase(configId), []);

  const saveConfigOnly = useCallback(
    (
      type: Parameters<typeof saveConfigOnlyUseCase>[0],
      config: Parameters<typeof saveConfigOnlyUseCase>[1],
      displayConfig?: Parameters<typeof saveConfigOnlyUseCase>[2],
    ) => saveConfigOnlyUseCase(type, config, displayConfig),
    [],
  );

  const removeConfig = useCallback((configId: string) => removeConfigUseCase(configId), []);

  const closeSession = useCallback((id: number) => closeSessionUseCase(id), []);

  const reconnectSession = useCallback((id: number) => reconnectSessionUseCase(id), []);

  const renameSession = useCallback(
    (id: number, name: string) => renameSessionUseCase(id, name),
    [],
  );

  const applyDisplayConfigToLiveSession = useCallback(
    (id: number, patch: Parameters<typeof applyDisplayConfigToLiveSessionUseCase>[1]) =>
      applyDisplayConfigToLiveSessionUseCase(id, patch),
    [],
  );

  return {
    createLocalSession,
    createSshSession,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSession,
    createTmuxSessionOnly,
    saveConfigOnly,
    openFromConfig,
    removeConfig,
    closeSession,
    reconnectSession,
    renameSession,
    applyDisplayConfigToLiveSession,
  };
}

/**
 * Legacy exports kept so external callers (e.g. the tmux bootstrap
 * helper inside `useTauriListeners`) don't break during the cutover.
 *
 * - `insertTmuxControlAndBootstrapWindow`: the synchronous bootstrap
 *   install path. Lives in `app/useCases/createTmuxSession.ts`; the
 *   re-export keeps the legacy call site compiling.
 *
 * - `assertSessionNotUsedElsewhere`: a pure rule from
 *   `model/rules/sessionRules.ts`. Re-exported through the legacy
 *   helpers so the test file that imports it from this module keeps
 *   working.
 */
export { assertSessionNotUsedElsewhere } from "../../../../app/rules/sessionRules";
