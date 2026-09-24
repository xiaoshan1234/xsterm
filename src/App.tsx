import { useEffect } from "react";
import AppLayout from "./ui/AppLayout";
import { SessionBridge } from "./service/bridges/sessionBridge";
import { OutputBridge } from "./service/bridges/outputBridge";
import { TmuxBridge } from "./service/bridges/tmuxBridge";
import { AutoAttachBridge } from "./service/bridges/autoAttachBridge";
import { ThemeBridge } from "./service/bridges/themeBridge";
import { LoggerBridge } from "./service/bridges/loggerBridge";
import { SessionProvider } from "./service/legacy/contexts/SessionContext";
import { ThemeProvider } from "./service/legacy/contexts/ThemeContext";
import { LoggerProvider } from "./service/legacy/contexts/LoggerContext";
import { useSessionStore } from "./service/session/store";
import { runWorkspaceCleanupForSessions } from "./service/bridges/sessionBridge";
import { bindDefaultMirrorWriter } from "./model/session/model";
import { useSessionModel } from "./model/session/useSessionModel";
import "./ui/styles/global.css";
import "./ui/styles/layout.css";

// ---------------------------------------------------------------------------
// Phase 3 wiring: bind the default SessionModel mirror to the Zustand
// store so model writes propagate to React subscribers.
//
// Must run at module load — before any SessionModel is constructed.
// ---------------------------------------------------------------------------

bindDefaultMirrorWriter({
  replaceSessions(sessions) {
    useSessionStore.getState().setSessions(sessions);
  },
  updateSession(id, patch) {
    useSessionStore.getState().updateSession(id, patch);
  },
  addSession(session) {
    useSessionStore.getState().addSession(session);
  },
  removeSession(id) {
    useSessionStore.getState().removeSession(id);
  },
  markSessionConnected(id, isConnected) {
    useSessionStore.getState().markSessionConnected(id, isConnected);
  },
  beginEstablishing(id) {
    useSessionStore.getState().beginEstablishing(id);
  },
  endEstablishing(id) {
    useSessionStore.getState().endEstablishing(id);
  },
});

export default function App() {
  // The session model is the single owner of the session registry.
  // It subscribes to `bus.onClosed` / `bus.onDisconnected` at
  // construction; the `onSessionClosed` callback wires the cross-service
  // workspace pane-tree cleanup.
  const sessionModel = useSessionModel({
    onSessionClosed: (sessionId) => runWorkspaceCleanupForSessions([sessionId]),
  });

  // Hydrate once on mount. The legacy `useTauriListeners` hook no
  // longer drives session-list load (it focuses on tmux events);
  // the SessionModel is the authoritative source.
  useEffect(() => {
    void sessionModel.hydrate();
  }, [sessionModel]);

  return (
    <SessionProvider>
      <ThemeProvider>
        <LoggerProvider>
          <SessionBridge model={sessionModel} />
          <OutputBridge />
          <TmuxBridge />
          <AutoAttachBridge />
          <ThemeBridge />
          <LoggerBridge />
          <AppLayout />
        </LoggerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
