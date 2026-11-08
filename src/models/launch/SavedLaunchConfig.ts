import { createLaunchConfigId, type LaunchConfigId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import {
  createTerminalDisplayOverrides,
  type TerminalDisplayOverrides,
} from "../terminal/TerminalDisplayConfig";
import { type TerminalLaunchConfig } from "./TerminalLaunchConfig";
import { type TmuxLaunchConfig } from "./TmuxLaunchConfig";

/**
 * Persisted launch configuration used by the saved-launch list. It is not a
 * runtime state object; opening an item creates a `Terminal` or
 * `TmuxController`.
 *
 * Display overrides are stored separately from connection/launch properties so
 * presentation defaults can evolve without rewriting SSH or shell settings.
 */
export interface SavedLaunchConfig {
  readonly version: 1;
  readonly id: LaunchConfigId;
  readonly name: string;
  readonly config: TerminalLaunchConfig | TmuxLaunchConfig;
  readonly displayConfig?: TerminalDisplayOverrides;
}

export interface CreateSavedLaunchConfigInput {
  id: string;
  name: string;
  config: TerminalLaunchConfig | TmuxLaunchConfig;
  displayConfig?: TerminalDisplayOverrides;
}

export function createSavedLaunchConfig(
  input: CreateSavedLaunchConfigInput,
): ModelResult<SavedLaunchConfig> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "Saved launch name must not be empty");
  }

  let displayConfig: TerminalDisplayOverrides | undefined;
  if (input.displayConfig) {
    const displayResult = createTerminalDisplayOverrides(input.displayConfig);
    if (!displayResult.ok) {
      return displayResult;
    }
    displayConfig = displayResult.value;
  }

  try {
    return modelSuccess({
      version: 1,
      id: createLaunchConfigId(input.id),
      name,
      config: input.config,
      ...(displayConfig ? { displayConfig } : {}),
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid launch config id",
    );
  }
}
