/**
 * renameSession — rename a runtime session and the matching
 * `SavedSessionConfig`. The backend session name is not changed; only
 * the frontend label and the saved-config label are updated.
 */
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";

export function renameSession(id: number, name: string): void {
  const sessionStore = useSessionStore.getState();
  const session = sessionStore.sessions.find((s) => s.id === id);
  sessionStore.setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  if (session) {
    const persistenceStore = usePersistenceStore.getState();
    persistenceStore.setSavedConfigs((prev) =>
      prev.map((c) => (c.id === session.configId ? { ...c, name } : c)),
    );
  }
}
