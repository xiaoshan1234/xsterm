import { useShortcuts } from "./useShortcut";
import { useSession } from "../contexts/SessionContext";

export function useAppShortcuts({
  onCreateSession,
  onToggleLogs,
}: {
  onCreateSession: () => void;
  onToggleLogs: () => void;
}) {
  const { sessions, activeSessionId, setActiveSession, closeSession } = useSession();

  useShortcuts([
    { key: "n", ctrl: true, shift: true, handler: onCreateSession },
    {
      key: "Tab",
      ctrl: true,
      handler: () => {
        if (sessions.length <= 1) return;
        const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
        const nextIndex = (currentIndex + 1) % sessions.length;
        setActiveSession(sessions[nextIndex].id);
      },
    },
    {
      key: "Tab",
      ctrl: true,
      shift: true,
      handler: () => {
        if (sessions.length <= 1) return;
        const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
        const prevIndex = (currentIndex - 1 + sessions.length) % sessions.length;
        setActiveSession(sessions[prevIndex].id);
      },
    },
    {
      key: "w",
      ctrl: true,
      handler: () => {
        if (activeSessionId !== null) {
          closeSession(activeSessionId);
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
