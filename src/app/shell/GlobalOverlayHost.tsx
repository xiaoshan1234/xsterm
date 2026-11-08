import { type ReactNode } from "react";

interface GlobalOverlayHostProps {
  children?: ReactNode;
}

export function GlobalOverlayHost({ children }: GlobalOverlayHostProps) {
  return (
    <div className="shell-overlay-host" aria-live="polite">
      {children}
    </div>
  );
}
