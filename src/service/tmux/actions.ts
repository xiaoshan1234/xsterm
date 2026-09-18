/**
 * Tmux service — action function surface.
 *
 * **Scope**: tmux-side state mutations. The session-store also
 * exposes a tmux-error surface (retry banner state); those are
 * accessed via `service/session/actions.ts` to keep the retry
 * banner's lookup path short. This store's actions are limited
 * to controller-id → config / window-list caches that the
 * tmuxBridge writes and the windows-control UI reads.
 *
 * **No cross-service imports** — bridges wire tmux events into
 * both `service/tmux/*` (config / window list) and
 * `service/session/*` (session rows) stores.
 */
import type { TmuxCcConfig, TmuxWindowListEntry } from "../../model";
import { useTmuxStore, type TmuxStoreState } from "./store";

export function setTmuxControllerConfigs(
  next: Map<number, TmuxCcConfig> | ((p: Map<number, TmuxCcConfig>) => Map<number, TmuxCcConfig>),
): void {
  useTmuxStore.getState().setTmuxControllerConfigs(next);
}

export function setTmuxWindowLists(
  next:
    | Map<number, TmuxWindowListEntry[]>
    | ((p: Map<number, TmuxWindowListEntry[]>) => Map<number, TmuxWindowListEntry[]>),
): void {
  useTmuxStore.getState().setTmuxWindowLists(next);
}

export function rememberControllerConfig(controllerId: number, config: TmuxCcConfig): void {
  useTmuxStore.getState().rememberControllerConfig(controllerId, config);
}

export function forgetControllerConfig(controllerId: number): void {
  useTmuxStore.getState().forgetControllerConfig(controllerId);
}

export function rememberWindowList(controllerId: number, entries: TmuxWindowListEntry[]): void {
  useTmuxStore.getState().rememberWindowList(controllerId, entries);
}

export function upsertWindowListEntry(controllerId: number, entry: TmuxWindowListEntry): void {
  useTmuxStore.getState().upsertWindowListEntry(controllerId, entry);
}

export function removeWindowListEntry(controllerId: number, tmuxWindowId: string): void {
  useTmuxStore.getState().removeWindowListEntry(controllerId, tmuxWindowId);
}

export function renameWindowListEntry(
  controllerId: number,
  tmuxWindowId: string,
  name: string,
): void {
  useTmuxStore.getState().renameWindowListEntry(controllerId, tmuxWindowId, name);
}

export function getControllerConfig(controllerId: number): TmuxCcConfig | undefined {
  return useTmuxStore.getState().tmuxControllerConfigs.get(controllerId);
}

export function getWindowList(controllerId: number): TmuxWindowListEntry[] | undefined {
  return useTmuxStore.getState().tmuxWindowLists.get(controllerId);
}

export function resetTmuxService(): void {
  useTmuxStore.getState().reset();
}

export function useTmuxActions(): Pick<
  TmuxStoreState,
  "tmuxControllerConfigs" | "tmuxWindowLists"
> {
  return useTmuxStore((s) => ({
    tmuxControllerConfigs: s.tmuxControllerConfigs,
    tmuxWindowLists: s.tmuxWindowLists,
  }));
}
