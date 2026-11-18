import { useState, type Dispatch, type SetStateAction } from "react";
import { type SavedTerminalConfig, type TerminalGroup } from "../../../models/runtime/terminal";

export interface LaunchConfigState {
  savedConfigs: SavedTerminalConfig[];
  setSavedConfigs: Dispatch<SetStateAction<SavedTerminalConfig[]>>;
  groups: TerminalGroup[];
  setGroups: Dispatch<SetStateAction<TerminalGroup[]>>;
  nextGroupId: number;
  setNextGroupId: Dispatch<SetStateAction<number>>;
}

export function useLaunchConfigState(): LaunchConfigState {
  const [savedConfigs, setSavedConfigs] = useState<SavedTerminalConfig[]>([]);
  const [groups, setGroups] = useState<TerminalGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);

  return {
    savedConfigs,
    setSavedConfigs,
    groups,
    setGroups,
    nextGroupId,
    setNextGroupId,
  };
}
