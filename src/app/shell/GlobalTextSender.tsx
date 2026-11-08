interface TextSenderTarget {
  id: string;
  label: string;
  breadcrumb: string;
  status: string;
  isAvailable: boolean;
}

interface GlobalTextSenderProps {
  targets: readonly TextSenderTarget[];
  selectedTargetId: string;
  onSelectTarget: (targetId: string) => void;
}

export function GlobalTextSender({
  targets,
  selectedTargetId,
  onSelectTarget,
}: GlobalTextSenderProps) {
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);

  return (
    <section className="shell-text-sender" aria-label="Global text sender">
      <header className="shell-text-sender-header">
        <div>
          <div className="shell-eyebrow">Global Tool</div>
          <h2>Text Sender</h2>
        </div>
        <div className="shell-text-sender-target">
          <label htmlFor="shell-target-select">Target pane</label>
          <select
            id="shell-target-select"
            value={selectedTargetId}
            onChange={(event) => onSelectTarget(event.target.value)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label} · {target.breadcrumb}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="shell-text-sender-grid">
        <div className="shell-text-sender-editor">
          <textarea
            aria-label="Command text"
            defaultValue={"echo \"preview target\"\nprintf 'ready\\n'"}
            spellCheck={false}
          />
        </div>
        <aside className="shell-text-sender-side">
          <div className="shell-status-block">
            <span className="shell-status-label">Target status</span>
            <strong>{selectedTarget?.status ?? "Unavailable"}</strong>
            <span>{selectedTarget?.breadcrumb}</span>
          </div>
          <div className="shell-sender-controls">
            <button type="button" className="btn btn--primary">
              Send
            </button>
            <button type="button" className="btn btn--secondary">
              Schedule
            </button>
          </div>
          <div className="shell-status-block">
            <span className="shell-status-label">Queue</span>
            <span>3 lines ready · no active job</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
