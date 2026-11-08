import { type PreviewDialogId } from "./types";

interface MainAreaPreviewProps {
  onOpenDialog: (dialog: PreviewDialogId) => void;
}

export function MainAreaPreview({ onOpenDialog }: MainAreaPreviewProps) {
  return (
    <section className="shell-workspace-preview" aria-label="Workspace preview">
      <header className="shell-window-tabs">
        <div className="shell-window-tabs-list">
          <button type="button" className="shell-window-tab shell-window-tab--active">
            1. Main
          </button>
          <button type="button" className="shell-window-tab">
            2. tmux dev:@1
          </button>
        </div>
        <div className="shell-window-actions">
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("create-terminal")}
          >
            Create Terminal
          </button>
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("create-tmux")}
          >
            Create tmux
          </button>
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("edit-terminal")}
          >
            Edit Terminal
          </button>
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("edit-tmux")}
          >
            Edit tmux
          </button>
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("rename")}
          >
            Rename
          </button>
          <button
            type="button"
            className="shell-text-button"
            onClick={() => onOpenDialog("confirm")}
          >
            Confirm
          </button>
          <button
            type="button"
            className="shell-text-button shell-text-button--danger"
            onClick={() => onOpenDialog("error")}
          >
            Error
          </button>
        </div>
      </header>
      <div className="shell-pane-preview">
        <div className="shell-pane-preview-main">
          <div className="shell-pane-label">Pane 1 · Local PowerShell</div>
          <pre className="shell-terminal-preview" aria-label="Terminal preview">
            {`PS C:\\Users\\developer> git status\nOn branch main\nnothing to commit, working tree clean\n\nPS C:\\Users\\developer> _`}
          </pre>
        </div>
        <div className="shell-pane-preview-side">
          <div className="shell-pane-label">Pane 2 · Production SSH</div>
          <pre className="shell-terminal-preview" aria-label="SSH terminal preview">
            {`deploy@prod:~$ tail -f app.log\n[info] server ready\n[info] worker connected\n_`}
          </pre>
        </div>
      </div>
    </section>
  );
}
