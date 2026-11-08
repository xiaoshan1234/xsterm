import { useWorkspaceLayout } from "../sessions";
import { type Workspace } from "../../models/legacy/terminal";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const { replaceInitWindowWithTerminal } = useWorkspaceLayout();

  return (
    <div className="init-window-view">
      <PaneInitCard
        onTerminalCreated={(terminal) =>
          replaceInitWindowWithTerminal(workspace.id, windowId, terminal)
        }
      />
    </div>
  );
}
