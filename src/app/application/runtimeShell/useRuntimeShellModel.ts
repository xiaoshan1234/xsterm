import { useMemo } from "react";
import { selectPaneTargetOptions } from "../../../features/command-sender";
import {
  tmuxSessionBaseKey,
  tmuxSessionKey,
  useSavedLaunchConfigs,
} from "../../../features/launch-config";
import { selectTerminalManagerGroups, useTerminalRuntime } from "../../../features/terminal";
import {
  selectTmuxManagerGroups,
  selectTmuxStatusControllers,
  useTmuxRuntime,
} from "../../../features/tmux";
import {
  selectWindowManagerItems,
  selectWorkspaceManagerItems,
  useWorkspaceLayout,
} from "../../../features/workspace";
import { selectRuntimeStatus } from "./runtimeStatusViewModel";

export function useRuntimeShellModel() {
  const terminalRuntime = useTerminalRuntime();
  const tmuxRuntime = useTmuxRuntime();
  const launchConfig = useSavedLaunchConfigs();
  const workspaceLayout = useWorkspaceLayout();

  const { terminals, getTerminalSize } = terminalRuntime;
  const { openTmuxSessions } = tmuxRuntime;
  const { savedConfigs, groups } = launchConfig;
  const { workspaces, activeWorkspaceId, savedWorkspaces, savedWindowConfigs } = workspaceLayout;

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );

  const terminalManagerGroups = useMemo(
    () => selectTerminalManagerGroups(savedConfigs, groups),
    [groups, savedConfigs],
  );

  const tmuxManagerGroups = useMemo(() => {
    const openSessionKeys = new Set(
      openTmuxSessions.map((session) => tmuxSessionKey(session.config)),
    );
    const openConfigIds = new Set(
      openTmuxSessions
        .map((session) => session.configId)
        .filter((configId): configId is string => configId !== undefined),
    );
    const openBaseKeys = new Set(
      openTmuxSessions.map((session) => tmuxSessionBaseKey(session.config)),
    );
    return selectTmuxManagerGroups(savedConfigs, openSessionKeys, openConfigIds, openBaseKeys);
  }, [openTmuxSessions, savedConfigs]);

  const tmuxStatusControllers = useMemo(
    () => selectTmuxStatusControllers(terminals, savedConfigs),
    [savedConfigs, terminals],
  );

  const runtimeStatus = useMemo(
    () => selectRuntimeStatus(activeWorkspace, terminals, tmuxStatusControllers, getTerminalSize),
    [activeWorkspace, getTerminalSize, terminals, tmuxStatusControllers],
  );

  const windowManagerItems = useMemo(
    () => selectWindowManagerItems(savedWindowConfigs),
    [savedWindowConfigs],
  );

  const workspaceManagerItems = useMemo(
    () => selectWorkspaceManagerItems(savedWorkspaces, workspaces),
    [savedWorkspaces, workspaces],
  );

  const paneTargetOptions = useMemo(
    () => selectPaneTargetOptions(workspaces, terminals, savedConfigs),
    [savedConfigs, terminals, workspaces],
  );

  return {
    terminalRuntime,
    tmuxRuntime,
    launchConfig,
    workspaceLayout,
    activeWorkspace,
    terminalManagerGroups,
    tmuxManagerGroups,
    runtimeStatus,
    windowManagerItems,
    workspaceManagerItems,
    paneTargetOptions,
  };
}

export type RuntimeShellModel = ReturnType<typeof useRuntimeShellModel>;
