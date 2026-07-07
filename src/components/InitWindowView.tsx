import { useSession } from "../contexts/SessionContext";
import { Workspace } from "../types/session";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const { replaceInitWindowWithSession } = useSession();

  return (
    <div className="init-window-view">
      <PaneInitCard
        onSessionCreated={(session) =>
          replaceInitWindowWithSession(workspace.id, windowId, session)
        }
      />
    </div>
  );
}
