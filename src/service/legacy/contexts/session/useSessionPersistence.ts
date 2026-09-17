/**
 * Session persistence hook — wires the tauri-plugin-store file
 * (`sessions.json`) and the `settings.json` file to the service
 * persistence store.
 *
 * **Migration story**:
 * - Legacy: `useSessionPersistence` used local `useState` setters and
 *   called `sessionStorage.persistConfigs` after every update.
 * - Now: state lives in `src/service/persistence/store.ts` (Zustand) and
 *   `src/service/session/store.ts` (for `globalLocalEcho`). This hook
 *   only owns the *I/O* wiring: load on mount, write on change.
 *
 * **Public surface (`SessionPersistence`)** is preserved:
 * - `updateConfigs(updater)` — applies a function to the current
 *   `savedConfigs` and triggers a debounced disk write.
 * - `updateGroups(updater, nextId?)` — same idea for groups +
 *   `nextGroupId`.
 * - `persistSavedWorkspaces(data)` — explicit flush.
 * - `persistSavedWindowConfigs(data)` — explicit flush.
 *
 * Side-effects (load on mount, debounced write on change) are
 * side-effects of this hook, not part of the public interface.
 */
import { useCallback, useEffect } from "react";
import type { SavedWindowConfig, SavedWorkspace, SessionGroup } from "../../../../model/entities";
import type { SavedSessionConfig } from "../../../../model/entities";
import { loadSavedConfigs, persistConfigs } from "../../../../infra/store/savedConfigs";
import { loadSavedGroups, persistGroups } from "../../../../infra/store/groups";
import { loadSavedWorkspaces, persistWorkspaces } from "../../../../infra/store/savedWorkspaces";
import { loadSavedWindowConfigs, persistWindowConfigs } from "../../../../infra/store/savedWindows";
import { getSettingsStore } from "../../../../infra/tauri/commands/persistence";
import { usePersistenceStore } from "../../../../service/persistence/store";
import { useSessionStore } from "../../../../service/session/store";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../../../../app/rules/constants";
import { type SessionPersistence } from "./types";

interface UseSessionPersistenceOptions {
  /** Latest snapshot — used by the load effect for "should I re-load?" check. */
  savedConfigs: SavedSessionConfig[];
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  groups: SessionGroup[];
  nextGroupId: number;
  globalLocalEcho: boolean;
}

export function useSessionPersistence(options: UseSessionPersistenceOptions): SessionPersistence {
  const {
    savedConfigs,
    savedWorkspaces,
    savedWindowConfigs,
    groups,
    nextGroupId,
    globalLocalEcho,
  } = options;
  const persistenceStore = usePersistenceStore;

  // --- one-shot load on mount ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [configs, savedGroups, workspacesData, windowConfigs] = await Promise.all([
          loadSavedConfigs(),
          loadSavedGroups(),
          loadSavedWorkspaces(),
          loadSavedWindowConfigs(),
        ]);
        if (cancelled) return;
        persistenceStore.getState().setSavedConfigs(configs);
        if (savedGroups.groups.some((g) => g.id === DEFAULT_GROUP_ID)) {
          persistenceStore.getState().setGroups(savedGroups.groups);
        } else {
          persistenceStore.getState().setGroups([
            {
              id: DEFAULT_GROUP_ID,
              name: DEFAULT_GROUP_NAME,
              configIds: [],
              collapsed: false,
            },
            ...savedGroups.groups,
          ]);
        }
        persistenceStore.getState().setNextGroupId(savedGroups.nextGroupId);
        persistenceStore.getState().setSavedWorkspaces(workspacesData);
        persistenceStore.getState().setSavedWindowConfigs(windowConfigs);
      } catch (e) {
        console.error("Failed to load persisted sessions:", e);
      }

      try {
        const store = await getSettingsStore();
        const savedGlobalEcho = await store.get<boolean>("globalLocalEcho");
        if (savedGlobalEcho !== null && savedGlobalEcho !== undefined && !cancelled) {
          useSessionStore.getState().setGlobalLocalEchoAction(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Empty deps: this effect should only run once on mount. The
    // `options.*` values are snapshot at mount time — later changes are
    // persisted by the per-field effects further below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- debounced writes on `savedConfigs` change -------------------------
  useEffect(() => {
    // skip first run: the load effect just wrote this exact value
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void persistConfigs(savedConfigs);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [savedConfigs]);

  // --- groups + write both arrays + nesting together ------------------
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void persistGroups({ groups, nextGroupId });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [groups, nextGroupId]);

  // --- debounced write of savedWorkspaces (driven by store subscription) -
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void persistWorkspaces(savedWorkspaces);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [savedWorkspaces]);

  // --- debounced write of savedWindowConfigs -----------------------------
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void persistWindowConfigs(savedWindowConfigs);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [savedWindowConfigs]);

  // --- `globalLocalEcho` persists to `settings.json` ---------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getSettingsStore();
        if (cancelled) return;
        await store.set("globalLocalEcho", globalLocalEcho);
        await store.save();
      } catch (e) {
        console.error("Failed to save global settings:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [globalLocalEcho]);

  // --- public actions ----------------------------------------------------
  const updateConfigs = useCallback(
    (updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => {
      persistenceStore.getState().setSavedConfigs((prev) => {
        const updated = updater(prev as never);
        void persistConfigs(updated as never);
        return updated as never;
      });
    },
    [persistenceStore],
  );

  const updateGroups = useCallback(
    (updater: (prev: SessionGroup[]) => SessionGroup[], nextIdArg?: number) => {
      persistenceStore.getState().setGroups((prev) => {
        const updated = updater(prev);
        void persistGroups({ groups: updated, nextGroupId: nextIdArg ?? nextGroupId });
        return updated;
      });
    },
    [persistenceStore, nextGroupId],
  );

  const persistSavedWorkspaces = useCallback((data: SavedWorkspace[]) => {
    void persistWorkspaces(data);
  }, []);

  const persistSavedWindowConfigs = useCallback((data: SavedWindowConfig[]) => {
    void persistWindowConfigs(data);
  }, []);

  return {
    updateConfigs,
    updateGroups,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
  };
}
