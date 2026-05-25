import { useEffect, useCallback } from "react";

type KeyHandler = () => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: KeyHandler;
}

export function useKeyboardShortcut(shortcut: Shortcut) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const ctrl = shortcut.ctrl ?? false;
      const shift = shortcut.shift ?? false;
      const alt = shortcut.alt ?? false;

      if (
        event.key.toLowerCase() === shortcut.key.toLowerCase() &&
        event.ctrlKey === ctrl &&
        event.shiftKey === shift &&
        event.altKey === alt
      ) {
        event.preventDefault();
        shortcut.handler();
      }
    },
    [shortcut]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
