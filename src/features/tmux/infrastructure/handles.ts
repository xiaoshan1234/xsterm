export type BackendControllerHandle = number & {
  readonly __brand: "BackendControllerHandle";
};

export type BackendWindowHandle = number & {
  readonly __brand: "BackendWindowHandle";
};

export function toBackendControllerHandle(value: number): BackendControllerHandle {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Backend controller handle must be a non-negative safe integer");
  }
  return value as BackendControllerHandle;
}

export function toBackendWindowHandle(value: number): BackendWindowHandle {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Backend window handle must be a non-negative safe integer");
  }
  return value as BackendWindowHandle;
}
