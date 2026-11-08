import { type ReactNode } from "react";
import { MAX_TOOL_PANEL_WIDTH, MIN_TOOL_PANEL_WIDTH } from "./useToolPanelWidth";

interface ToolPanelProps {
  title: string;
  width: number;
  onResizeStart: (event: React.MouseEvent) => void;
  onResizeBy: (delta: number) => void;
  children: ReactNode;
}

export function ToolPanel({ title, width, onResizeStart, onResizeBy, children }: ToolPanelProps) {
  return (
    <section className="shell-tool-panel" aria-label={title} style={{ width: `${width}px` }}>
      <header className="shell-tool-panel-header">
        <h2>{title}</h2>
      </header>
      <div className="shell-tool-panel-body">{children}</div>
      <div
        className="shell-tool-panel-resizer"
        role="separator"
        aria-label={`Resize ${title}`}
        aria-orientation="vertical"
        aria-valuemin={MIN_TOOL_PANEL_WIDTH}
        aria-valuemax={MAX_TOOL_PANEL_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={onResizeStart}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResizeBy(-8);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResizeBy(8);
          }
        }}
      />
    </section>
  );
}
