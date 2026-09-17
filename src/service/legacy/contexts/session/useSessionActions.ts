/**
 * `useSessionActions` — composition root for the public `SessionActions`
 * surface exposed through `useSession()`.
 *
 * **After Commit 5**:
 * - State lives in `src/service/`-star-`/store.ts` (read by `useSessionState`)
 * - Side effects live in `src/app/useCases/*` (called by the per-concern
 *   hooks below)
 * - This file is now the assembly point that re-spreads the slices into
 *   one `SessionActions` object.
 *
 * **Composition order matters**:
 * - `useWorkspaceActions` must be called first so we have a
 *   `createDefaultWorkspace` to hand to `useSessionLifecycle`.
 * - `useSessionLifecycle` and `useWindowActions` consume that helper.
 * - `usePersistenceActions` (which composes `useSavedWorkspaceActions` +
 *   `useSavedWindowActions`) needs `openFromConfigInternal`. The use
 *   cases already own that internal helper, so this hook no longer
 *   threads it through.
 */
import { useMemo } from "react";
import { type SessionActions } from "./types";
import { useGroupActions } from "./useGroupActions";
import { usePaneActions } from "./usePaneActions";
import { usePersistenceActions } from "./usePersistenceActions";
import { useSessionLifecycle } from "./useSessionLifecycle";
import { useWindowActions } from "./useWindowActions";
import { useWorkspaceActions } from "./useWorkspaceActions";
import type {
  SavedSessionConfig as LegacySavedSessionConfig,
  SavedWindowConfig as LegacySavedWindowConfig,
  SavedWorkspace as LegacySavedWorkspace,
  Session,
  SessionGroup,
  Window,
  Workspace,
} from "../../types/session";

interface UseSessionActionsOptions {
  savedConfigs: LegacySavedSessionConfig[];
  savedWorkspaces: LegacySavedWorkspace[];
  savedWindowConfigs: LegacySavedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  sessionsRef: React.MutableRefObject<Session[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<LegacySavedWorkspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<LegacySavedWindowConfig[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  activeWorkspaceId: string | null;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  nextGroupId: number;
  setNextGroupId: React.Dispatch<React.SetStateAction<number>>;
  updateConfigs: (
    updater: (prev: LegacySavedSessionConfig[]) => LegacySavedSessionConfig[],
  ) => void;
  updateGroups: (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: LegacySavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: LegacySavedWindowConfig[]) => void;
}

export function useSessionActions(opts: UseSessionActionsOptions): SessionActions {
  const {
    savedConfigs,
    savedWorkspaces,
    savedWindowConfigs,
    setActiveWorkspaceId,
    activeWorkspaceId,
    nextGroupId,
    setNextGroupId,
    updateConfigs,
    updateGroups,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
    workspacesRef,
    sessionsRef,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
  } = opts;

  const workspaceActions = useWorkspaceActions({
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSessions,
    establishingSessionsRef,
  });

  const lifecycle = useSessionLifecycle({});

  const windowActions = useWindowActions({
    savedConfigs,
    sessionsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
  });

  const pane = usePaneActions({
    sessionsRef,
    workspacesRef,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
  });

  const persistence = usePersistenceActions({
    savedWorkspaces,
    savedWindowConfigs,
    workspacesRef,
    sessionsRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSavedWorkspaces: opts.setSavedWorkspaces,
    setSavedWindowConfigs: opts.setSavedWindowConfigs,
    setSessions,
    establishingSessionsRef,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
    // openFromConfigInternal is owned by the openSavedSession use case
    // now; this shim keeps the legacy deps bag compiling without
    // actually being invoked.
    openFromConfigInternal: async (configId: string) => {
      const { openSavedSession } = await import("../../../../app/useCases/openSavedSession");
      return openSavedSession(configId);
    },
  });

  const group = useGroupActions({
    nextGroupId,
    setNextGroupId,
    updateConfigs: updateConfigs as never,
    updateGroups: updateGroups as never,
  });

  // Stable reference — every per-concern hook returns memoised callbacks
  // already, but wrapping the assembled object in useMemo makes the
  // `value` object identity stable across renders (only changes when
  // `opts` changes).
  return useMemo<SessionActions>(
    () => ({
      // lifecycle
      createLocalSession: lifecycle.createLocalSession,
      createSshSession: lifecycle.createSshSession,
      createLocalSessionOnly: lifecycle.createLocalSessionOnly,
      createSshSessionOnly: lifecycle.createSshSessionOnly,
      createTmuxSession: lifecycle.createTmuxSession,
      createTmuxSessionOnly: lifecycle.createTmuxSessionOnly,
      saveConfigOnly: lifecycle.saveConfigOnly as unknown as SessionActions["saveConfigOnly"],
      openFromConfig: lifecycle.openFromConfig,
      removeConfig: lifecycle.removeConfig,
      closeSession: lifecycle.closeSession,
      reconnectSession: lifecycle.reconnectSession,
      renameSession: lifecycle.renameSession,
      createSessionFromSavedConfig: lifecycle.openFromConfig,
      applyDisplayConfigToLiveSession: lifecycle.applyDisplayConfigToLiveSession,
      // window
      createWindow: windowActions.createWindow,
      createInitWindow: windowActions.createInitWindow,
      replaceInitWindowWithSession: windowActions.replaceInitWindowWithSession,
      createWindowFromSession: (
        sessionId: number,
        configId: string,
        name?: string,
        targetWorkspaceId?: string,
      ): Window => {
        // Legacy signature returned a Window synchronously. Route through
        // createWindow's `fromSession` variant — the legacy name `Window`
        // type is satisfied because the variant returns a built Window.
        return windowActions.createWindow(
          targetWorkspaceId ?? activeWorkspaceId ?? "",
          sessionId,
          configId,
          name,
        );
      },
      createWindowFromSavedConfig: windowActions.createWindowFromSavedConfig,
      closeWindow: windowActions.closeWindow,
      setActiveWindow: windowActions.setActiveWindow,
      reorderWindows: windowActions.reorderWindows,
      renameWindow: windowActions.renameWindow,
      // workspace
      createDefaultWorkspace: workspaceActions.createDefaultWorkspace,
      setActiveWorkspace: workspaceActions.setActiveWorkspace,
      closeWorkspace: workspaceActions.closeWorkspace,
      createWorkspaceFromSession: workspaceActions.createWorkspaceFromSession,
      // pane
      splitPane: pane.splitPane,
      updateWindowPaneTree: pane.updateWindowPaneTree,
      closePane: pane.closePane,
      writeSession: pane.writeSession,
      resizeSession: pane.resizeSession,
      setActivePane: windowActions.setActivePane,
      // persistence
      saveWorkspace: persistence.saveWorkspace,
      loadWorkspace: persistence.loadWorkspace,
      deleteSavedWorkspace: persistence.deleteSavedWorkspace,
      renameSavedWorkspace: persistence.renameSavedWorkspace,
      saveWindow: persistence.saveWindow,
      saveAllWindows: persistence.saveAllWindows,
      loadWindow: persistence.loadWindow,
      deleteSavedWindow: persistence.deleteSavedWindow,
      renameSavedWindow: persistence.renameSavedWindow,
      // group
      createGroup: group.createGroup,
      deleteGroup: group.deleteGroup,
      addToGroup: group.addToGroup,
      removeFromGroup: group.removeFromGroup,
      moveConfigToGroup: group.moveConfigToGroup,
      renameGroup: group.renameGroup,
      toggleGroup: group.toggleGroup,
      updateConfig: group.updateConfig,
    }),
    [lifecycle, windowActions, pane, persistence, group, workspaceActions, activeWorkspaceId],
  );
}
