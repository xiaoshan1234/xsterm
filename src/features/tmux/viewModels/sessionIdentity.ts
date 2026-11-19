import { isTmuxPaneTerminal, type Terminal } from "../../terminal";
import {
  tmuxSessionKey,
  type SavedTerminalConfig,
  type TmuxSessionConfig,
} from "../../launch-config";

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
    if (
      terminals.some(
        (terminal) => isTmuxPaneTerminal(terminal) && terminal.tmux.controllerId === controllerId,
      )
    ) {
      return controllerId;
    }
  }
  return undefined;
}
