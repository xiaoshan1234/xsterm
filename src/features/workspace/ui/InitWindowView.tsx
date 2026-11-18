import { usePaneIntents } from "../state/PaneIntentContext";
import type { Workspace } from "../contracts";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const paneIntents = usePaneIntents();

  return (
    <div className="init-window-view">
      <PaneInitCard
        onAttachExistingTerminal={(terminalId) =>
          paneIntents.attachExistingTerminalToWindow({
            workspaceId: workspace.id,
            windowId,
            terminalId,
          })
        }
        onCreateLocal={(config, save) =>
          paneIntents.createLocalTerminalForWindow({
            workspaceId: workspace.id,
            windowId,
            config,
            save,
          })
        }
        onCreateSsh={(config, save) =>
          paneIntents.createSshTerminalForWindow({
            workspaceId: workspace.id,
            windowId,
            config,
            save,
          })
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
