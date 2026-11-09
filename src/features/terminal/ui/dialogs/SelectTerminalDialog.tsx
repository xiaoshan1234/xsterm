import { useMemo } from "react";
import { useSavedLaunchConfigs, useTerminalRuntime, useWorkspaceLayout } from "../../../sessions";
import { Dialog } from "../../../../shared/ui/Dialog";
import "./SelectTerminalDialog.css";

interface SelectTerminalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (terminalId: number) => void;
  onSelectConfig: (configId: string) => void;
  disabled?: boolean;
}

export function SelectTerminalDialog({
  isOpen,
  onClose,
  onSelectSession,
  onSelectConfig,
  disabled = false,
}: SelectTerminalDialogProps) {
  const { terminals } = useTerminalRuntime();
  const { savedConfigs } = useSavedLaunchConfigs();
  const { workspaces } = useWorkspaceLayout();

  const usedSessionIds = useMemo(() => {
    const used = new Set<number>();
    workspaces.forEach((workspace) => {
      workspace.windows.forEach((window) => {
        const collect = (node: typeof window.rootPane) => {
          if (node.type === "leaf" && node.terminalId !== undefined) {
            used.add(node.terminalId);
          }
          node.children?.forEach(collect);
        };
        collect(window.rootPane);
      });
    });
    return used;
  }, [workspaces]);

  const availableSessions = terminals.filter((s) => !usedSessionIds.has(s.id));
  // tmux sessions attach to all their windows at once and are opened through
  // the Tmux manager; they don't make sense as a single-pane attachment.
  const availableConfigs = savedConfigs.filter((config) => config.type !== "tmux-pane");

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Select Terminal"
      size="medium"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <div className="select-terminal-dialog">
        {availableSessions.length === 0 && availableConfigs.length === 0 ? (
          <p className="select-terminal-empty">No available terminals or saved configs.</p>
        ) : (
          <>
            {availableSessions.length > 0 && (
              <section className="select-terminal-section">
                <h3>Existing unused terminals</h3>
                <ul className="select-terminal-list">
                  {availableSessions.map((terminal) => (
                    <li key={terminal.id}>
                      <button
                        className="select-terminal-item"
                        disabled={disabled}
                        onClick={() => onSelectSession(terminal.id)}
                      >
                        <span className="select-terminal-name">{terminal.name}</span>
                        <span className="select-terminal-type">{terminal.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {availableConfigs.length > 0 && (
              <section className="select-terminal-section">
                <h3>Saved configs</h3>
                <ul className="select-terminal-list">
                  {availableConfigs.map((config) => (
                    <li key={config.id}>
                      <button
                        className="select-terminal-item"
                        disabled={disabled}
                        onClick={() => onSelectConfig(config.id)}
                      >
                        <span className="select-terminal-name">{config.name}</span>
                        <span className="select-terminal-type">{config.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
