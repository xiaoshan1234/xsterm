import type { WindowId } from "../../../models";
import { usePaneIntents } from "../state/PaneIntentContext";
import { usePaneSessionIntents } from "../state/PaneSessionIntentContext";
import type { Workspace } from "../contracts";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: WindowId;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const paneIntents = usePaneIntents();
  const paneSessionIntents = usePaneSessionIntents();

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
          paneSessionIntents.createLocalTerminalForWindow({
            workspaceId: workspace.id,
            windowId,
            config,
            save,
          })
        }
        onCreateSsh={(config, save) =>
          paneSessionIntents.createSshTerminalForWindow({
            workspaceId: workspace.id,
            windowId,
            config,
            save,
          })
        }
        onCreateFromSavedConfig={(configId) =>
          paneSessionIntents.createSavedConfigForWindow({
            workspaceId: workspace.id,
            windowId,
            configId,
          })
        }
      />
    </div>
  );
}
