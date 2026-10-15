import type { ReactNode } from "react";
import "./IconStrip.css";

export interface IconStripItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface IconStripProps {
  activeId: string | null;
  items: IconStripItem[];
  onSelect: (id: string) => void;
}

export default function IconStrip({ activeId, items, onSelect }: IconStripProps) {
  return (
    <nav className="iconStrip" aria-label="Activity bar">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            className={`iconStripItem${isActive ? " iconStripItemActive" : ""}`}
            aria-label={item.label}
            aria-pressed={isActive}
            title={item.label}
            onClick={() => onSelect(item.id)}
          >
            <span className="iconStripItemIcon">{item.icon}</span>
          </button>
        );
      })}
    </nav>
  );
}
