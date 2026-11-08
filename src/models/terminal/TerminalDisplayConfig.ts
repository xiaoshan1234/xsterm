import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { createAutomaticTerminalSizing, type TerminalSizingMode } from "./TerminalSizingMode";

/**
 * Partial user preference persisted with a saved launch. Missing values are
 * inherited from global defaults and then from runtime overrides.
 */
export interface TerminalDisplayOverrides {
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly cursorStyle?: "block" | "underline" | "bar";
  readonly cursorBlink?: boolean;
  readonly cursorWidth?: number;
  readonly scrollbackLines?: number;
  readonly showLineNumbers?: boolean;
  readonly showTimestamps?: boolean;
  readonly sizingMode?: TerminalSizingMode;
}

/** Effective settings consumed by the terminal view after all defaults merge. */
export interface ResolvedTerminalDisplayConfig {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly cursorStyle: "block" | "underline" | "bar";
  readonly cursorBlink: boolean;
  readonly cursorWidth: number;
  readonly scrollbackLines: number;
  readonly showLineNumbers: boolean;
  readonly showTimestamps: boolean;
  readonly sizingMode: TerminalSizingMode;
}

export function createDefaultTerminalDisplayConfig(): ResolvedTerminalDisplayConfig {
  return {
    fontSize: 14,
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    lineHeight: 1,
    letterSpacing: 0,
    cursorStyle: "block",
    cursorBlink: true,
    cursorWidth: 1,
    scrollbackLines: 20_000,
    showLineNumbers: true,
    showTimestamps: false,
    sizingMode: createAutomaticTerminalSizing(),
  };
}

export function createTerminalDisplayOverrides(
  input: TerminalDisplayOverrides,
): ModelResult<TerminalDisplayOverrides> {
  return validateTerminalDisplayOverrides(input);
}

/**
 * Resolves global defaults, saved overrides, and runtime overrides from left to
 * right. A later non-undefined value wins.
 */
export function resolveTerminalDisplayConfig(
  defaults: ResolvedTerminalDisplayConfig,
  ...overridesList: readonly (TerminalDisplayOverrides | undefined)[]
): ModelResult<ResolvedTerminalDisplayConfig> {
  let resolved = defaults;

  for (const overrides of overridesList) {
    if (!overrides) continue;

    const validationResult = validateTerminalDisplayOverrides(overrides);
    if (!validationResult.ok) {
      return validationResult;
    }
    const normalized = validationResult.value;

    resolved = {
      fontSize: normalized.fontSize ?? resolved.fontSize,
      fontFamily: normalized.fontFamily ?? resolved.fontFamily,
      lineHeight: normalized.lineHeight ?? resolved.lineHeight,
      letterSpacing: normalized.letterSpacing ?? resolved.letterSpacing,
      cursorStyle: normalized.cursorStyle ?? resolved.cursorStyle,
      cursorBlink: normalized.cursorBlink ?? resolved.cursorBlink,
      cursorWidth: normalized.cursorWidth ?? resolved.cursorWidth,
      scrollbackLines: normalized.scrollbackLines ?? resolved.scrollbackLines,
      showLineNumbers: normalized.showLineNumbers ?? resolved.showLineNumbers,
      showTimestamps: normalized.showTimestamps ?? resolved.showTimestamps,
      sizingMode: normalized.sizingMode ?? resolved.sizingMode,
    };
  }

  return modelSuccess(resolved);
}

function validateTerminalDisplayOverrides(
  input: TerminalDisplayOverrides,
): ModelResult<TerminalDisplayOverrides> {
  if (input.fontSize !== undefined && !isInRange(input.fontSize, 8, 48)) {
    return modelFailure("invalid-value", "Terminal font size must be between 8 and 48");
  }
  if (input.fontFamily !== undefined && !input.fontFamily.trim()) {
    return modelFailure("invalid-value", "Terminal font family must not be empty");
  }
  if (input.lineHeight !== undefined && !isInRange(input.lineHeight, 0.8, 3)) {
    return modelFailure("invalid-value", "Terminal line height must be between 0.8 and 3");
  }
  if (input.letterSpacing !== undefined && !isInRange(input.letterSpacing, -5, 20)) {
    return modelFailure("invalid-value", "Terminal letter spacing must be between -5 and 20");
  }
  if (input.cursorWidth !== undefined && !isInRange(input.cursorWidth, 1, 10)) {
    return modelFailure("invalid-value", "Terminal cursor width must be between 1 and 10");
  }
  if (
    input.scrollbackLines !== undefined &&
    (!Number.isInteger(input.scrollbackLines) ||
      input.scrollbackLines < 0 ||
      input.scrollbackLines > 1_000_000)
  ) {
    return modelFailure(
      "invalid-value",
      "Terminal scrollback lines must be an integer between 0 and 1000000",
    );
  }
  if (input.sizingMode?.kind === "fixed") {
    if (
      !Number.isInteger(input.sizingMode.columns) ||
      input.sizingMode.columns < 1 ||
      input.sizingMode.columns > 1_000
    ) {
      return modelFailure("invalid-value", "Terminal columns must be between 1 and 1000");
    }
    if (
      !Number.isInteger(input.sizingMode.rows) ||
      input.sizingMode.rows < 1 ||
      input.sizingMode.rows > 500
    ) {
      return modelFailure("invalid-value", "Terminal rows must be between 1 and 500");
    }
  }

  return modelSuccess({
    ...input,
    ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily.trim() } : {}),
  });
}

function isInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
