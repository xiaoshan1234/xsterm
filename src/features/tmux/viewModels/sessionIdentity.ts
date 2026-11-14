import {
  type SavedTerminalConfig,
  type Terminal,
  type TmuxSessionConfig,
} from "../../../models/legacy/terminal";

export function tmuxSessionKey(config: TmuxSessionConfig): string {
  const transport = config.ssh
    ? `ssh:${config.ssh.username}@${config.ssh.host}:${config.ssh.port}`
    : config.transport === "wsl"
      ? `wsl:${config.wslDistribution?.trim() ?? ""}`
      : "local";
  const socket = config.socketName?.trim() || "default";
  const session = config.tmuxSessionName?.trim() || "";
  return `${transport}|${socket}|${session}`;
}

export function tmuxSessionBaseKey(config: TmuxSessionConfig): string {
  const baseConfigId = config.baseConfigId?.trim();
  if (!baseConfigId) return tmuxSessionKey(config);
  const socket = config.socketName?.trim() || "default";
  const session = config.tmuxSessionName?.trim() || "";
  return `${baseConfigId}|${socket}|${session}`;
}

export function defaultTmuxDisplayName(
  config: TmuxSessionConfig,
  fallbackSessionName?: string,
): string {
  const session = config.tmuxSessionName?.trim() || fallbackSessionName?.trim() || "tmux";
  const socket = config.socketName?.trim() || "default";
  return `${session}:${socket}`;
}

export function generatedTmuxSessionName(): string {
  return `xsterm-${crypto.randomUUID().slice(0, 8)}`;
}

export function isTmuxDisplayNameAvailable(
  name: string,
  configs: readonly SavedTerminalConfig[],
  options: {
    baseConfigId?: string;
    excludeConfigId?: string;
  } = {},
): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return !configs.some(
    (config) =>
      config.type === "tmux-pane" &&
      config.id !== options.excludeConfigId &&
      config.config.baseConfigId === options.baseConfigId &&
      config.name.trim().toLocaleLowerCase() === normalized,
  );
}

export function uniqueTmuxDisplayName(
  desiredName: string,
  configs: readonly SavedTerminalConfig[],
  options: {
    baseConfigId?: string;
    excludeConfigId?: string;
  } = {},
): string {
  const base = desiredName.trim() || "tmux";
  if (isTmuxDisplayNameAvailable(base, configs, options)) return base;

  let suffix = 2;
  while (!isTmuxDisplayNameAvailable(`${base} (${suffix})`, configs, options)) {
    suffix += 1;
  }
  return `${base} (${suffix})`;
}

export function findOpenTmuxControllerId(
  config: TmuxSessionConfig,
  savedConfigs: readonly SavedTerminalConfig[],
  controllerConfigIds: ReadonlyMap<number, string>,
  controllerConfigs: ReadonlyMap<number, TmuxSessionConfig>,
  terminals: readonly Terminal[],
): number | undefined {
  if (!config.tmuxSessionName?.trim()) return undefined;
  const targetKey = tmuxSessionKey(config);
  const configById = new Map(savedConfigs.map((candidate) => [candidate.id, candidate]));

  for (const [controllerId, configId] of controllerConfigIds) {
    const savedConfig = configById.get(configId);
    const openConfig =
      controllerConfigs.get(controllerId) ??
      (savedConfig?.type === "tmux-pane" ? savedConfig.config : undefined);
    if (!openConfig || tmuxSessionKey(openConfig) !== targetKey) {
      continue;
    }
    if (terminals.some((terminal) => terminal.tmuxSessionId === controllerId)) {
      return controllerId;
    }
  }
  return undefined;
}
