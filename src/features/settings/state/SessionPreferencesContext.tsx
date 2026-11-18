import { createContext, useContext, type ReactNode } from "react";
import { type SessionPreferencesContextType } from "../contracts";

interface SessionPreferencesProviderProps {
  children: ReactNode;
  value: SessionPreferencesContextType;
}

const SessionPreferencesContext = createContext<SessionPreferencesContextType | null>(null);

export function SessionPreferencesProvider({ children, value }: SessionPreferencesProviderProps) {
  return (
    <SessionPreferencesContext.Provider value={value}>
      {children}
    </SessionPreferencesContext.Provider>
  );
}

export function useSessionPreferences(): SessionPreferencesContextType {
  const value = useContext(SessionPreferencesContext);
  if (value === null) {
    throw new Error("useSessionPreferences must be used within SessionPreferencesProvider");
  }
  return value;
}
