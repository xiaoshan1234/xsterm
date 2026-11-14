import { ChevronIcon, PlusIcon } from "../../shared/icons/Icon";
import { type PreviewDialogId, type ToolId } from "./types";

interface ManagerPreviewProps {
  activeTool: ToolId;
  onOpenDialog: (dialog: PreviewDialogId) => void;
}

export function ManagerPreview({ activeTool, onOpenDialog }: ManagerPreviewProps) {
  switch (activeTool) {
    case "terminal-manager":
      return (
        <PreviewManagerFrame
          footer={
            <>
              <button
                type="button"
                className="btn btn--primary shell-manager-action"
                onClick={() => onOpenDialog("create-terminal")}
              >
                <PlusIcon size={14} />
                New Terminal
              </button>
              <button type="button" className="btn btn--secondary shell-manager-action">
                <PlusIcon size={14} />
                New Group
              </button>
            </>
          }
        >
          <ManagerGroup label="Ungrouped" isOpen>
            <ManagerItem title="Local PowerShell" onEdit={() => onOpenDialog("edit-terminal")} />
            <ManagerItem title="Production SSH" onEdit={() => onOpenDialog("edit-terminal")} />
          </ManagerGroup>
          <ManagerGroup label="Work" isOpen={false} />
        </PreviewManagerFrame>
      );

    case "tmux-manager":
      return (
        <PreviewManagerFrame
          footer={
            <button
              type="button"
              className="btn btn--primary shell-manager-action"
              onClick={() => onOpenDialog("create-tmux")}
            >
              <PlusIcon size={14} />
              New Tmux Session
            </button>
          }
        >
          <ManagerGroup label="WSL" isOpen>
            <ManagerItem title="WSL work" onEdit={() => onOpenDialog("edit-tmux")} />
            <ManagerItem title="WSL codex" onEdit={() => onOpenDialog("edit-tmux")} />
          </ManagerGroup>
          <ManagerGroup label="Mac" isOpen={false} />
        </PreviewManagerFrame>
      );

    case "window-manager":
      return (
        <PreviewManagerFrame
          footer={
            <button type="button" className="btn btn--primary shell-manager-action">
              <PlusIcon size={14} />
              New Window
            </button>
          }
        >
          <ManagerItem title="Editor" />
          <ManagerItem title="Server Logs" />
        </PreviewManagerFrame>
      );

    case "workspace-manager":
      return (
        <PreviewManagerFrame
          footer={
            <button type="button" className="btn btn--primary shell-manager-action">
              <PlusIcon size={14} />
              New Workspace
            </button>
          }
        >
          <ManagerItem title="default" />
          <ManagerItem title="Project X" />
        </PreviewManagerFrame>
      );

    case "settings":
      return (
        <div className="shell-manager-scroll">
          <SettingsRow label="Theme" value="Dark" />
          <SettingsRow label="Terminal font" value="Cascadia Mono" />
          <SettingsRow label="Global local echo" value="Off" />
          <SettingsRow label="Log level" value="Warn" />
        </div>
      );
  }
}

function PreviewManagerFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="shell-manager">
      <div className="shell-manager-scroll">{children}</div>
      {footer && <footer className="shell-manager-footer">{footer}</footer>}
    </div>
  );
}

function ManagerGroup({
  label,
  isOpen,
  children,
}: {
  label: string;
  isOpen: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="shell-manager-group">
      <button type="button" className="shell-manager-group-header">
        <span className={isOpen ? "shell-chevron shell-chevron--open" : "shell-chevron"}>
          <ChevronIcon size={12} />
        </span>
        <span>{label}</span>
      </button>
      {isOpen && <div className="shell-manager-group-items">{children}</div>}
    </section>
  );
}

function ManagerItem({ title, onEdit }: { title: string; onEdit?: () => void }) {
  return (
    <div className="shell-manager-item">
      <div className="shell-manager-item-copy">
        <strong>{title}</strong>
      </div>
      {onEdit && (
        <button type="button" className="shell-text-button" onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="shell-settings-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
