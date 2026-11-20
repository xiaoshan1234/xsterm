import { createContext, useContext, type ReactNode } from "react";
import type { ApplicationPersistenceSaveError } from "./types";

export interface ApplicationPersistenceStatus {
  saveError: ApplicationPersistenceSaveError | null;
  clearSaveError: () => void;
}

const ApplicationPersistenceStatusContext = createContext<ApplicationPersistenceStatus | null>(
  null,
);

export function ApplicationPersistenceStatusProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ApplicationPersistenceStatus;
}) {
  return (
    <ApplicationPersistenceStatusContext.Provider value={value}>
      {children}
    </ApplicationPersistenceStatusContext.Provider>
  );
}

export function useApplicationPersistenceStatus(): ApplicationPersistenceStatus {
  const value = useContext(ApplicationPersistenceStatusContext);
  if (value === null) {
    throw new Error(
      "useApplicationPersistenceStatus must be used within ApplicationPersistenceStatusProvider",
    );
  }
  return value;
}
