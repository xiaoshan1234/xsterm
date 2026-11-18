export type BackendTerminalHandle = number & {
  readonly __brand: "BackendTerminalHandle";
};

export function toBackendTerminalHandle(value: number): BackendTerminalHandle {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Backend terminal handle must be a non-negative safe integer");
  }
  return value as BackendTerminalHandle;
}
