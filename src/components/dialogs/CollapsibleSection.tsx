import { type ReactNode } from "react";

interface CollapsibleSectionProps {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * `<details>`-based section group used by the settings form to group related
 * fields under a foldable header. Defaults to open.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <details
      className={`common-settings-group${className ? ` ${className}` : ""}`}
      open={defaultOpen}
    >
      <summary className="common-settings-group__title">{title}</summary>
      <div className="common-settings-group__content">{children}</div>
    </details>
  );
}
