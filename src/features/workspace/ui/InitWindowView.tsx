import { useWorkspaceLayout } from "../state/WorkspaceContext";
import { usePaneIntents } from "../state/PaneIntentContext";
import type { Workspace } from "../../../features/workspace";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const { replaceInitWindowWithTerminal } = useWorkspaceLayout();
  const paneIntents = usePaneIntents();

  return (
    <div className="init-window-view">
      <PaneInitCard
        onTerminalCreated={(terminal) =>
          replaceInitWindowWithTerminal(workspace.id, windowId, terminal)
        }
        onCreateFromSavedConfig={(configId) =>
          paneIntents.createSavedConfigForWindow({
            workspaceId: workspace.id,
            windowId,
            configId,
          })
        }
      />
    </div>
  );
}
