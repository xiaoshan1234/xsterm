import { type ReactNode } from "react";
import { ChevronIcon, PlusIcon } from "../icons/Icon";
import "./ManagerPanel.css";

export function ManagerPanelFrame({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="manager-panel">
      <div className="manager-panel-scroll">{children}</div>
      {footer && <footer className="manager-panel-footer">{footer}</footer>}
    </div>
  );
}

export function ManagerSection({
  label,
  isExpanded,
  onToggle,
  actions,
  children,
}: {
  label: string;
  isExpanded: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="manager-section">
      <div className="manager-section-header-row">
        <button type="button" className="manager-section-header" onClick={onToggle}>
          <span
            className={isExpanded ? "manager-chevron manager-chevron--open" : "manager-chevron"}
          >
            <ChevronIcon size={12} />
          </span>
          <span>{label}</span>
        </button>
        {actions && <div className="manager-section-actions">{actions}</div>}
      </div>
      {isExpanded && <div className="manager-section-items">{children}</div>}
    </section>
  );
}

export function ManagerRow({
  title,
  subtitle,
  badge,
  children,
  onClick,
  onDoubleClick,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  children?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      className="manager-row"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="manager-row-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {badge && <span className="manager-row-badge">{badge}</span>}
      {children}
    </div>
  );
}

export function ManagerActionButton({
  label,
  onClick,
  variant = "secondary",
}: {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      className={`btn ${variant === "primary" ? "btn--primary" : "btn--secondary"} manager-action`}
      onClick={onClick}
    >
      <PlusIcon size={14} />
      {label}
    </button>
  );
}

export function ManagerStatusHeader({ label, value }: { label: string; value: string }) {
  return (
    <div className="manager-status-header">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ManagerEmptyState({ children }: { children: ReactNode }) {
  return <div className="manager-empty-state">{children}</div>;
}
