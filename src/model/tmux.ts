export interface TmuxSessionBackend {
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
  /** Owning tmux controller id (u32). Required for every tmux IPC command. */
  tmuxControllerId: number;
  tmuxServerPaneId: string[];
  tmuxServerWindowId: string[];
  localToserverPaneId: Map<string, string>[];
  localToserverWindowId: Map<string, string>[];
  serverTolocalPaneId: Map<string, string>[];
  serverTolocalWindowId: Map<string, string>[];
}
