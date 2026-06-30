import { useShortcuts } from "./useShortcut";
import { useSession } from "../contexts/SessionContext";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { sessions, activeSessionIds, focusedPane, setActiveSession, closeSession } = useSession();

  useShortcuts([
    { key: "n", ctrl: true, shift: true, handler: onCreateSession },
    {
      key: "Tab",
      ctrl: true,
      handler: () => {
        const paneSessions = sessions.filter((s) => (s.pane ?? 1) === focusedPane);
        if (paneSessions.length <= 1) return;
        const currentId = activeSessionIds.get(focusedPane) ?? null;
        const currentIndex = paneSessions.findIndex((s) => s.id === currentId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % paneSessions.length : 0;
        setActiveSession(focusedPane, paneSessions[nextIndex].id);
      },
    },
    {
      key: "Tab",
      ctrl: true,
      shift: true,
      handler: () => {
        const paneSessions = sessions.filter((s) => (s.pane ?? 1) === focusedPane);
        if (paneSessions.length <= 1) return;
        const currentId = activeSessionIds.get(focusedPane) ?? null;
        const currentIndex = paneSessions.findIndex((s) => s.id === currentId);
        const prevIndex = currentIndex >= 0
          ? (currentIndex - 1 + paneSessions.length) % paneSessions.length
          : paneSessions.length - 1;
        setActiveSession(focusedPane, paneSessions[prevIndex].id);
      },
    },
    {
      key: "w",
      ctrl: true,
      handler: () => {
        const activeId = activeSessionIds.get(focusedPane);
        if (activeId !== undefined) {
          closeSession(activeId);
        }
      },
    },
    {
      key: "l",
      ctrl: true,
      handler: onToggleLogs,
    },
  ]);
}
