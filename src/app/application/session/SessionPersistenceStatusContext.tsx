import { createContext, useContext, type ReactNode } from "react";
import type { SessionPersistenceSaveError } from "./types";

export interface SessionPersistenceStatus {
  saveError: SessionPersistenceSaveError | null;
  clearSaveError: () => void;
}

const SessionPersistenceStatusContext = createContext<SessionPersistenceStatus | null>(null);

export function SessionPersistenceStatusProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SessionPersistenceStatus;
}) {
  return (
    <SessionPersistenceStatusContext.Provider value={value}>
      {children}
    </SessionPersistenceStatusContext.Provider>
  );
}

export function useSessionPersistenceStatus(): SessionPersistenceStatus {
  const value = useContext(SessionPersistenceStatusContext);
  if (value === null) {
    throw new Error(
      "useSessionPersistenceStatus must be used within SessionPersistenceStatusProvider",
    );
  }
  return value;
}
