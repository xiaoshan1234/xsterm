/**
 * Session state hook — reads from the service Zustand stores.
 *
 * **Why this exists**:
 * - The legacy version used `useState` + refs (state was React-local).
 * - The new architecture (Commit 3+) holds state in src/service/-star-/store.ts
 *   so non-React callers (bridges, use cases) can read/write synchronously
 *   via `store.getState()`.
 *
 * **What this file does**:
 * - Subscribes to the relevant slices of the service stores and exposes
 *   the SAME field shape that the rest of the React tree consumes via
 *   `useSession()`. The public API of `useSessionContext` doesn't change.
 * - The legacy hook still owns the "active workspace fallback" effect
 *   (when `activeWorkspaceId === null && workspaces.length > 0`, pick the
 *   first one). That effect runs as a side-effect of subscribing to
 *   `workspaces` / `activeWorkspaceId`.
 *
 * **Refs**:
 * - The legacy hook kept `sessionsRef`, `workspacesRef`,
 *   `establishingSessionsRef`. These are still useful for the tmux
 *   listener which reads them synchronously. They're now stored inside
 *   `useSessionStore` / `useWorkspaceStore` and we surface them as the
 *   SAME field names so consumers don't change.
 *
 * **Type shim**: the new `src/model/entities` types use a non-discriminated
 * `PersistedSessionConfig` (single shape with a union `type` field) while the
 * legacy `src/types/session` types use a discriminated `SessionType`
 * union. The runtime shape is identical, so we cast at the boundary.
 *
 * **What does NOT live here**:
 * - State mutators (used to be local `setX` callbacks). They moved into
 *   the stores + use cases; callers use `useSessionStore(s => s.addSession)`
 *   or call `useSessionStore.getState().addSession(...)` directly.
 * - Persistence side-effects (`sessionStorage.persistConfigs` etc.) — they
 *   moved into `useSessionPersistence` (which now uses `infra/store/`-star-`).
 */
import { useEffect, useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useSessionStore } from "../../../../service/session/store";
import { useWorkspaceStore } from "../../../../service/workspace/store";
import { usePersistenceStore } from "../../../../service/persistence/store";
import {
  type Session,
  type SessionGroup,
  type Workspace,
  type TmuxCcConfig,
  type TmuxWindowListEntry,
} from "../../../../model";
import type {
  PersistedSessionConfig as LegacySavedSessionConfig,
  PersistedWindowConfig as LegacySavedWindowConfig,
  PersistedWorkspace as LegacySavedWorkspace,
  TmuxControllerError,
} from "../../../../model";
import { type SessionState } from "./types";

export function useSessionState(): SessionState {
  // --- session registry ------------------------------------------------
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const sessionsRef = useSessionStore((s) => s.sessionsRef);
  const establishingSessionsRef = useSessionStore((s) => s.establishingSessionsRef);

  // --- workspace registry + active selection --------------------------
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const workspacesRef = useWorkspaceStore((s) => s.workspacesRef);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  // --- persistence (saved configs / workspaces / window configs) ------
  const modelSavedConfigs = usePersistenceStore((s) => s.savedConfigs);
  const setSavedConfigsModel = usePersistenceStore((s) => s.setSavedConfigs);
  const modelSavedWorkspaces = usePersistenceStore((s) => s.savedWorkspaces);
  const setSavedWorkspacesModel = usePersistenceStore((s) => s.setSavedWorkspaces);
  const modelSavedWindowConfigs = usePersistenceStore((s) => s.savedWindowConfigs);
  const setSavedWindowConfigsModel = usePersistenceStore((s) => s.setSavedWindowConfigs);

  // Cast the model-shaped stores to the legacy discriminated-union types
  // expected by the rest of the React tree. Runtime data is identical;
  // the only difference is the structural TS signature.
  const savedConfigs = modelSavedConfigs as unknown as LegacySavedSessionConfig[];
  const setSavedConfigs = setSavedConfigsModel as unknown as Dispatch<
    SetStateAction<LegacySavedSessionConfig[]>
  >;
  const savedWorkspaces = modelSavedWorkspaces as unknown as LegacySavedWorkspace[];
  const setSavedWorkspaces = setSavedWorkspacesModel as unknown as Dispatch<
    SetStateAction<LegacySavedWorkspace[]>
  >;
  const savedWindowConfigs = modelSavedWindowConfigs as unknown as LegacySavedWindowConfig[];
  const setSavedWindowConfigs = setSavedWindowConfigsModel as unknown as Dispatch<
    SetStateAction<LegacySavedWindowConfig[]>
  >;

  // --- groups + nextGroupId --------------------------------------------
  const groups = usePersistenceStore((s) => s.groups) as unknown as SessionGroup[];
  const setGroups = usePersistenceStore((s) => s.setGroups) as unknown as Dispatch<
    SetStateAction<SessionGroup[]>
  >;
  const nextGroupId = usePersistenceStore((s) => s.nextGroupId);
  const setNextGroupId = usePersistenceStore((s) => s.setNextGroupId) as unknown as Dispatch<
    SetStateAction<number>
  >;

  // --- local-echo settings ---------------------------------------------
  const globalLocalEcho = useSessionStore((s) => s.globalLocalEcho);
  const setGlobalLocalEchoAction = useSessionStore((s) => s.setGlobalLocalEchoAction);
  // Compatibility alias: the legacy hook named the setter `setGlobalLocalEcho`,
  // but the store internally uses `setGlobalLocalEchoAction` (the public
  // setter `setGlobalLocalEcho` has a different type signature — boolean only,
  // not Dispatch<SetStateAction<boolean>>).
  const setGlobalLocalEcho = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      if (typeof next === "function") {
        const resolved = (next as (prev: boolean) => boolean)(
          useSessionStore.getState().globalLocalEcho,
        );
        setGlobalLocalEchoAction(resolved);
      } else {
        setGlobalLocalEchoAction(next);
      }
    },
    [setGlobalLocalEchoAction],
  );
  const sessionLocalEchoOverrides = useSessionStore((s) => s.sessionLocalEchoOverrides);
  const getEffectiveLocalEcho = useSessionStore((s) => s.getEffectiveLocalEcho);

  // --- tmux retry-banner state ----------------------------------------
  const tmuxControllerErrors = useSessionStore((s) => s.tmuxControllerErrors);
  const setTmuxControllerErrors = useSessionStore((s) => s.setTmuxControllerErrors);
  const tmuxControllerConfigsRef = useSessionStore((s) => s.tmuxControllerConfigsRef);
  const tmuxWindowListsRef = useSessionStore((s) => s.tmuxWindowListsRef);

  // --- keep the workspace "active workspace fallback" effect ----------
  // The legacy hook did: if activeWorkspaceId is null/points at a dropped
  // workspace, fall back to the first workspace's id. The store doesn't
  // own that effect (it's UI policy), so we replicate it here.
  useEffect(() => {
    if (activeWorkspaceId === null && workspaces.length > 0) {
      setActiveWorkspaceId(workspaces[0].id);
      return;
    }
    if (activeWorkspaceId !== null && !workspaces.some((w) => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0]?.id ?? null);
    }
  }, [workspaces, activeWorkspaceId, setActiveWorkspaceId]);

  return {
    savedConfigs,
    setSavedConfigs,
    sessions,
    setSessions: setSessions as Dispatch<SetStateAction<Session[]>>,
    workspaces,
    setWorkspaces: setWorkspaces as Dispatch<SetStateAction<Workspace[]>>,
    activeWorkspaceId,
    setActiveWorkspaceId,
    savedWorkspaces,
    setSavedWorkspaces,
    savedWindowConfigs,
    setSavedWindowConfigs,
    groups,
    setGroups,
    nextGroupId,
    setNextGroupId,
    globalLocalEcho,
    setGlobalLocalEcho: setGlobalLocalEcho as Dispatch<SetStateAction<boolean>>,
    sessionLocalEchoOverrides,
    sessionsRef: sessionsRef as MutableRefObject<Session[]>,
    workspacesRef: workspacesRef as MutableRefObject<Workspace[]>,
    establishingSessionsRef: establishingSessionsRef as MutableRefObject<Set<number>>,
    getEffectiveLocalEcho,
    tmuxControllerErrors,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef: tmuxControllerConfigsRef as MutableRefObject<
      Map<number, TmuxCcConfig>
    >,
    tmuxWindowListsRef: tmuxWindowListsRef as MutableRefObject<Map<number, TmuxWindowListEntry[]>>,
  };
}

// Re-export so the legacy test (`useSessionActions.helpers.test.ts`) keeps
// importing the same TmuxControllerError type through this module.
export type { TmuxControllerError };
