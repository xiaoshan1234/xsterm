import { useMemo } from "react";
import { useSession } from "../../contexts/SessionContext";
import { Dialog } from "../ui/Dialog";

interface SelectSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: number) => void;
  onSelectConfig: (configId: string) => void;
  disabled?: boolean;
}

export function SelectSessionDialog({
  isOpen,
  onClose,
  onSelectSession,
  onSelectConfig,
  disabled = false,
}: SelectSessionDialogProps) {
  const { sessions, savedConfigs, workspaces } = useSession();

  const usedSessionIds = useMemo(() => {
    const used = new Set<number>();
    workspaces.forEach((workspace) => {
      workspace.windows.forEach((window) => {
        const collect = (node: typeof window.rootPane) => {
          if (node.type === "leaf" && node.sessionId !== undefined) {
            used.add(node.sessionId);
          }
          node.children?.forEach(collect);
        };
        collect(window.rootPane);
      });
    });
    return used;
  }, [workspaces]);

  const availableSessions = sessions.filter((s) => !usedSessionIds.has(s.id));
  const availableConfigs = savedConfigs;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Select Session"
      size="medium"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <div className="select-session-dialog">
        {availableSessions.length === 0 && availableConfigs.length === 0 ? (
          <p className="select-session-empty">No available sessions or saved configs.</p>
        ) : (
          <>
            {availableSessions.length > 0 && (
              <section className="select-session-section">
                <h3>Existing unused sessions</h3>
                <ul className="select-session-list">
                  {availableSessions.map((session) => (
                    <li key={session.id}>
                      <button
                        className="select-session-item"
                        disabled={disabled}
                        onClick={() => onSelectSession(session.id)}
                      >
                        <span className="select-session-name">{session.name}</span>
                        <span className="select-session-type">{session.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {availableConfigs.length > 0 && (
              <section className="select-session-section">
                <h3>Saved configs</h3>
                <ul className="select-session-list">
                  {availableConfigs.map((config) => (
                    <li key={config.id}>
                    <button
                      className="select-session-item"
                      disabled={disabled}
                      onClick={() => onSelectConfig(config.id)}
                    >
                        <span className="select-session-name">{config.name}</span>
                        <span className="select-session-type">{config.type}</span>
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

