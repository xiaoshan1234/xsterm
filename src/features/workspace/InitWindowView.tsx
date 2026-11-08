import { useSession } from "../terminal/logic/TerminalContext";
import { type Workspace } from "../../types/terminal";
import { PaneInitCard } from "./PaneInitCard";
import "./InitWindowView.css";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const { replaceInitWindowWithTerminal } = useSession();

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
