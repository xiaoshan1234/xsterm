import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Environment overrides supplied when launching a shell or tmux controller.
 * Names are checked case-insensitively because Windows environment variables
 * are case-insensitive.
 */
export interface ShellEnvironmentConfig {
  readonly inheritParent: boolean;
  readonly variables: Readonly<Record<string, string>>;
}

export interface CreateShellEnvironmentConfigInput {
  inheritParent?: boolean;
  variables?: Readonly<Record<string, string>>;
}

export function createShellEnvironmentConfig(
  input: CreateShellEnvironmentConfigInput = {},
): ModelResult<ShellEnvironmentConfig> {
  const variables = input.variables ?? {};
  const normalizedVariables: Record<string, string> = Object.create(null);
  const normalizedNames = new Set<string>();

  for (const [name, value] of Object.entries(variables)) {
    if (!name || name.includes("=") || name.includes("\0")) {
      return modelFailure("invalid-value", `Invalid environment variable name: ${name}`);
    }
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      return modelFailure("invalid-value", `Reserved environment variable name: ${name}`);
    }

    const normalizedName = name.toLowerCase();
    if (normalizedNames.has(normalizedName)) {
      return modelFailure(
        "invalid-value",
        `Environment variable names differ only by case: ${name}`,
      );
    }
    normalizedNames.add(normalizedName);
    normalizedVariables[name] = value;
  }

  return modelSuccess({
    inheritParent: input.inheritParent ?? true,
    variables: normalizedVariables,
  });
}

export function mergeShellEnvironment(
  parentEnvironment: Readonly<Record<string, string>>,
  config: ShellEnvironmentConfig,
): Readonly<Record<string, string>> {
  const merged: Record<string, string> = Object.create(null);
  if (config.inheritParent) {
    for (const [name, value] of Object.entries(parentEnvironment)) {
      merged[name] = value;
    }
  }
  for (const [name, value] of Object.entries(config.variables)) {
    merged[name] = value;
  }
  return merged;
}
