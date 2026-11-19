export type ApplicationErrorCode =
  | "invalid-state"
  | "not-found"
  | "operation-in-progress"
  | "terminal-already-attached"
  | "unsupported-operation"
  | "workspace-name-conflict"
  | "workspace-name-reserved";

export interface ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly cause?: unknown;
}

export function createApplicationError(
  code: ApplicationErrorCode,
  message: string,
  cause?: unknown,
): ApplicationError {
  const error = new Error(message);
  error.name = "ApplicationError";
  Object.defineProperty(error, "code", {
    configurable: false,
    enumerable: true,
    value: code,
    writable: false,
  });

  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: false,
      enumerable: false,
      value: cause,
      writable: false,
    });
  }

  return error as ApplicationError;
}

export function isApplicationError(
  error: unknown,
  code?: ApplicationErrorCode,
): error is ApplicationError {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  const candidate = error as ApplicationError;
  return code === undefined || candidate.code === code;
}
