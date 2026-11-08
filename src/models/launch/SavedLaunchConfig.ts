import { createLaunchConfigId, type LaunchConfigId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { type TerminalLaunchConfig } from "./TerminalLaunchConfig";
import { type TmuxLaunchConfig } from "./TmuxLaunchConfig";

/**
 * This union is only for the saved-launch list in the UI.
 * It must not be used as a runtime state object.
 */
export interface SavedLaunchConfig {
  readonly id: LaunchConfigId;
  readonly name: string;
  readonly config: TerminalLaunchConfig | TmuxLaunchConfig;
}

export interface CreateSavedLaunchConfigInput {
  id: string;
  name: string;
  config: TerminalLaunchConfig | TmuxLaunchConfig;
}

export function createSavedLaunchConfig(
  input: CreateSavedLaunchConfigInput,
): ModelResult<SavedLaunchConfig> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "Saved launch name must not be empty");
  }

  try {
    return modelSuccess({
      id: createLaunchConfigId(input.id),
      name,
      config: input.config,
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid launch config id",
    );
  }
}
