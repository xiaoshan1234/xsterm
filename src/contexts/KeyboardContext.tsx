import { createContext, useContext, ReactNode } from 'react';
import { useShortcut } from '../hooks/useShortcut';

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
}

interface KeyboardContextType {
  registerShortcut: (config: ShortcutConfig) => () => void;
}

const KeyboardContext = createContext<KeyboardContextType | null>(null);

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const registerShortcut = (config: ShortcutConfig) => {
    useShortcut(config);
    return () => {
      // Cleanup handled by useShortcut's useEffect
    };
  };

  return (
    <KeyboardContext.Provider value={{ registerShortcut }}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard() {
  const context = useContext(KeyboardContext);
  if (!context) throw new Error('useKeyboard must be used within KeyboardProvider');
  return context;
}