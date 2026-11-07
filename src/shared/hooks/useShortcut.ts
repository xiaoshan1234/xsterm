import { useEffect, useRef } from "react";

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
}

function matchesShortcut(event: KeyboardEvent, config: ShortcutConfig): boolean {
  return (
    event.key.toLowerCase() === config.key.toLowerCase() &&
    !!event.ctrlKey === (config.ctrl ?? false) &&
    !!event.shiftKey === (config.shift ?? false) &&
    !!event.altKey === (config.alt ?? false)
  );
}

export function useShortcut(config: ShortcutConfig) {
  const handlerRef = useRef(config.handler);
  handlerRef.current = config.handler;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, config)) {
        event.preventDefault();
        handlerRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [config.key, config.ctrl, config.shift, config.alt]);
}

export function useShortcuts(configs: ShortcutConfig[]) {
  const configsRef = useRef(configs);
  configsRef.current = configs;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      for (const config of configsRef.current) {
        if (matchesShortcut(event, config)) {
          event.preventDefault();
          config.handler();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
