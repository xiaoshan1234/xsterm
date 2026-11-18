import { createContext, useContext, type ReactNode } from "react";

export interface ApplicationFeedbackActions {
  reportError: (title: string, cause: unknown) => void;
}

const defaultFeedback: ApplicationFeedbackActions = {
  reportError: (title, cause) => {
    console.error(title, cause);
  },
};

const ApplicationFeedbackContext = createContext<ApplicationFeedbackActions>(defaultFeedback);

export function ApplicationFeedbackProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ApplicationFeedbackActions;
}) {
  return (
    <ApplicationFeedbackContext.Provider value={value}>
      {children}
    </ApplicationFeedbackContext.Provider>
  );
}

export function useApplicationFeedback(): ApplicationFeedbackActions {
  return useContext(ApplicationFeedbackContext);
}
