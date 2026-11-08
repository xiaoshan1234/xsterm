import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Determines how environment variable names are compared. Windows shells and
 * some remote targets need case-insensitive handling; POSIX shells are
 * case-sensitive.
 */
export type EnvironmentVariableNameCase = "sensitive" | "insensitive";

/**
 * Environment overrides supplied when launching a shell or tmux controller.
 */
export interface ShellEnvironmentConfig {
  readonly inheritParent: boolean;
  readonly nameCase: EnvironmentVariableNameCase;
  readonly variables: Readonly<Record<string, string>>;
}

export interface CreateShellEnvironmentConfigInput {
  inheritParent?: boolean;
  nameCase?: EnvironmentVariableNameCase;
  variables?: Readonly<Record<string, string>>;
}

export function createShellEnvironmentConfig(
  input: CreateShellEnvironmentConfigInput = {},
): ModelResult<ShellEnvironmentConfig> {
  const variables = input.variables ?? {};
  const nameCase = input.nameCase ?? "sensitive";
  const normalizedVariables: Record<string, string> = Object.create(null);
  const normalizedNames = new Set<string>();

  for (const [name, value] of Object.entries(variables)) {
    if (!name || name.includes("=") || name.includes("\0")) {
      return modelFailure("invalid-value", `Invalid environment variable name: ${name}`);
    }
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      return modelFailure("invalid-value", `Reserved environment variable name: ${name}`);
    }

    if (nameCase === "insensitive") {
      const normalizedName = name.toLowerCase();
      if (normalizedNames.has(normalizedName)) {
        return modelFailure(
          "invalid-value",
          `Environment variable names differ only by case: ${name}`,
        );
      }
      normalizedNames.add(normalizedName);
    }
    normalizedVariables[name] = value;
  }

  return modelSuccess({
    inheritParent: input.inheritParent ?? true,
    nameCase,
    variables: normalizedVariables,
  });
}

export function mergeShellEnvironment(
  parentEnvironment: Readonly<Record<string, string>>,
  config: ShellEnvironmentConfig,
): Readonly<Record<string, string>> {
  const merged = new Map<string, { name: string; value: string }>();
  if (config.inheritParent) {
    for (const [name, value] of Object.entries(parentEnvironment)) {
      const key = config.nameCase === "insensitive" ? name.toLowerCase() : name;
      merged.set(key, { name, value });
    }
  }
  for (const [name, value] of Object.entries(config.variables)) {
    const key = config.nameCase === "insensitive" ? name.toLowerCase() : name;
    merged.set(key, { name, value });
  }

  return Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]));
}
