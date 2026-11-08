import { type ReactNode } from "react";
import { CloseIcon } from "../../shared/icons/Icon";

interface ToolPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function ToolPanel({ title, onClose, children }: ToolPanelProps) {
  return (
    <section className="shell-tool-panel" aria-label={title}>
      <header className="shell-tool-panel-header">
        <div>
          <div className="shell-eyebrow">Tools</div>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="shell-icon-button"
          aria-label={`Close ${title}`}
          title="Close"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="shell-tool-panel-body">{children}</div>
    </section>
  );
}
