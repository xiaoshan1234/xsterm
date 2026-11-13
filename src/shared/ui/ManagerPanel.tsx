import { type ReactNode } from "react";
import { ChevronIcon, PlusIcon } from "../icons/Icon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
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
  contextMenuItems,
  children,
}: {
  label: string;
  isExpanded: boolean;
  onToggle?: () => void;
  contextMenuItems?: readonly ContextMenuItem[];
  children?: ReactNode;
}) {
  const headerRow = (
    <div className="manager-section-header-row">
      <button type="button" className="manager-section-header" onClick={onToggle}>
        <span className={isExpanded ? "manager-chevron manager-chevron--open" : "manager-chevron"}>
          <ChevronIcon size={12} />
        </span>
        <span className="manager-section-label">{label}</span>
      </button>
    </div>
  );

  return (
    <section className="manager-section">
      {contextMenuItems && contextMenuItems.length > 0 ? (
        <ContextMenu items={[...contextMenuItems]} className="manager-section-context">
          {headerRow}
        </ContextMenu>
      ) : (
        headerRow
      )}
      {isExpanded && <div className="manager-section-items">{children}</div>}
    </section>
  );
}

export function ManagerRow({
  title,
  badge,
  isSelected = false,
  onSelect,
  onOpen,
  isExpanded,
  onToggleExpand,
  reserveChevron = false,
  contextMenuItems,
}: {
  title: string;
  badge?: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  reserveChevron?: boolean;
  contextMenuItems?: readonly ContextMenuItem[];
}) {
  const hasContextMenu = contextMenuItems !== undefined && contextMenuItems.length > 0;
  const row = (
    <div
      className={`manager-row${isSelected ? " manager-row--selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={hasContextMenu ? undefined : (event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen?.();
      }}
      role={onSelect ? "option" : undefined}
      aria-selected={onSelect ? isSelected : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      {onToggleExpand ? (
        <button
          type="button"
          className={`manager-row-chevron${isExpanded ? " manager-row-chevron--open" : ""}`}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          aria-expanded={isExpanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <ChevronIcon size={12} />
        </button>
      ) : reserveChevron ? (
        <span className="manager-row-chevron manager-row-chevron--spacer" aria-hidden="true" />
      ) : null}
      <div className="manager-row-copy">
        <strong>{title}</strong>
      </div>
      {badge && <span className="manager-row-badge">{badge}</span>}
    </div>
  );

  if (hasContextMenu && contextMenuItems) {
    return (
      <ContextMenu items={[...contextMenuItems]} className="manager-row-context" onOpen={onSelect}>
        {row}
      </ContextMenu>
    );
  }
  return row;
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

export function ManagerEmptyState({ children }: { children: ReactNode }) {
  return <div className="manager-empty-state">{children}</div>;
}
