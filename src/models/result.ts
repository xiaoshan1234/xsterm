export type ModelErrorCode =
  | "duplicate-id"
  | "invalid-id"
  | "invalid-layout"
  | "invalid-transition"
  | "invalid-value"
  | "not-found";

export interface ModelError {
  code: ModelErrorCode;
  message: string;
}

export interface ModelSuccess<Value> {
  ok: true;
  value: Value;
}

export interface ModelFailure {
  ok: false;
  error: ModelError;
}

export type ModelResult<Value> = ModelSuccess<Value> | ModelFailure;

export function modelSuccess<Value>(value: Value): ModelSuccess<Value> {
  return { ok: true, value };
}

export function modelFailure<Value = never>(
  code: ModelErrorCode,
  message: string,
): ModelResult<Value> {
  return {
    ok: false,
    error: { code, message },
  };
}
