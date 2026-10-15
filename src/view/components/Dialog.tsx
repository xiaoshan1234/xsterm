import { useEffect, useRef, type ReactNode } from "react";
import "./Dialog.css";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export default function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const onScrimClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="dialogOverlay" onClick={onScrimClick} role="presentation">
      <div ref={cardRef} className="dialogCard" role="dialog" aria-modal="true" aria-label={title}>
        {title ? (
          <header className="dialogHeader">
            <h2 className="dialogTitle">{title}</h2>
            <button
              ref={closeRef}
              className="dialogClose"
              type="button"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </header>
        ) : null}
        <div className="dialogBody">{children}</div>
      </div>
    </div>
  );
}
