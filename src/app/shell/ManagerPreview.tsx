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
            <ManagerItem
              title="Local PowerShell"
              subtitle="Local · powershell.exe"
              badge="Shell"
              onEdit={() => onOpenDialog("edit-terminal")}
            />
            <ManagerItem
              title="Production SSH"
              subtitle="SSH · deploy@example.com"
              badge="SSH"
              onEdit={() => onOpenDialog("edit-terminal")}
            />
          </ManagerGroup>
          <ManagerGroup label="Work" isOpen={false} />
        </PreviewManagerFrame>
      );

    case "terminal-status-manager":
      return (
        <PreviewManagerFrame>
          <StatusHeader count="2 live terminals" />
          <ManagerItem title="Production SSH" subtitle="Pane 2 · Window 1" badge="Connected" />
          <ManagerItem title="Local PowerShell" subtitle="Pane 1 · Window 1" badge="Connected" />
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
              New tmux Session
            </button>
          }
        >
          <ManagerItem
            title="tmux dev"
            subtitle="Local · socket work"
            badge="tmux"
            onEdit={() => onOpenDialog("edit-tmux")}
          />
          <ManagerItem
            title="Remote tmux"
            subtitle="SSH · build@example.com"
            badge="tmux"
            onEdit={() => onOpenDialog("edit-tmux")}
          />
        </PreviewManagerFrame>
      );

    case "tmux-status-manager":
      return (
        <PreviewManagerFrame>
          <StatusHeader count="1 controller · 3 windows · 7 panes" />
          <ManagerItem title="tmux dev" subtitle="Socket work · 3 windows" badge="Connected" />
          <div className="shell-status-tree">
            <span>@1 editor</span>
            <span>%1</span>
            <span>%2</span>
            <span>@2 server</span>
            <span>%3</span>
          </div>
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
          <ManagerItem title="Editor" subtitle="2 panes · saved" badge="Window" />
          <ManagerItem title="Server Logs" subtitle="3 panes · saved" badge="Window" />
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
          <ManagerItem title="default" subtitle="Current workspace" badge="Live" />
          <ManagerItem title="Project X" subtitle="2 windows · saved" badge="Saved" />
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

function ManagerItem({
  title,
  subtitle,
  badge,
  onEdit,
}: {
  title: string;
  subtitle: string;
  badge: string;
  onEdit?: () => void;
}) {
  return (
    <div className="shell-manager-item">
      <div className="shell-manager-item-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <span className="shell-badge">{badge}</span>
      {onEdit && (
        <button type="button" className="shell-text-button" onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}

function StatusHeader({ count }: { count: string }) {
  return (
    <div className="shell-status-header">
      <span>Runtime status</span>
      <span>{count}</span>
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
