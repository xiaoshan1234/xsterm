import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Automatic mode follows the pane container. Fixed mode is explicit so
 * `columns` and `rows` cannot be present while automatic sizing is active.
 */
export type TerminalSizingMode =
  | { readonly kind: "auto" }
  | {
      readonly kind: "fixed";
      readonly columns: number;
      readonly rows: number;
    };

export function createAutomaticTerminalSizing(): TerminalSizingMode {
  return { kind: "auto" };
}

export function createFixedTerminalSizing(
  columns: number,
  rows: number,
): ModelResult<TerminalSizingMode> {
  if (!Number.isInteger(columns) || columns < 1 || columns > 1_000) {
    return modelFailure("invalid-value", "Terminal columns must be between 1 and 1000");
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 500) {
    return modelFailure("invalid-value", "Terminal rows must be between 1 and 500");
  }

  return modelSuccess({
    kind: "fixed",
    columns,
    rows,
  });
}
