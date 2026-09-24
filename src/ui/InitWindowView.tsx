import { useSession } from "../service/legacy/contexts/SessionContext";
import { type Workspace } from "../model";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitialWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitialWindowViewProps) {
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
