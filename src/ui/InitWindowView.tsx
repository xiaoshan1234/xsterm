import { useSession } from "../service/legacy/contexts/SessionContext";
import { type Workspace } from "../model/entities";
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
