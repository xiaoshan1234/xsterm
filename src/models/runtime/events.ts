export interface TmuxPaneAddedEvent {
  controllerId: number;
  tmuxPaneId: string;
  xstermTerminalId: number;
  parentTmuxWindowId: string;
}

export interface TmuxPaneRemovedEvent {
  controllerId: number;
  tmuxPaneId: string;
  xstermTerminalId: number;
}

export interface TmuxWindowAddedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
  xstermTerminalId: number;
  xstermPaneId: string;
}

export interface TmuxWindowClosedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
}

export interface TmuxWindowRenamedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
  name: string;
}
