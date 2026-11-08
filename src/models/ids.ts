export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type WindowId = Brand<string, "WindowId">;
export type PaneId = Brand<string, "PaneId">;
export type LaunchConfigId = Brand<string, "LaunchConfigId">;

export type TerminalId = Brand<number, "TerminalId">;
export type TerminalStreamId = Brand<number, "TerminalStreamId">;
export type TmuxControllerId = Brand<number, "TmuxControllerId">;

export type TmuxWindowId = Brand<string, "TmuxWindowId">;
export type TmuxPaneId = Brand<string, "TmuxPaneId">;

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function createStringIdentifier<Name extends string>(
  value: string,
  name: Name,
): Brand<string, Name> {
  if (!isNonEmptyString(value)) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value as Brand<string, Name>;
}

function createNumericIdentifier<Name extends string>(
  value: number,
  name: Name,
): Brand<number, Name> {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as Brand<number, Name>;
}

export function createWorkspaceId(value: string): WorkspaceId {
  return createStringIdentifier(value, "WorkspaceId");
}

export function createWindowId(value: string): WindowId {
  return createStringIdentifier(value, "WindowId");
}

export function createPaneId(value: string): PaneId {
  return createStringIdentifier(value, "PaneId");
}

export function createLaunchConfigId(value: string): LaunchConfigId {
  return createStringIdentifier(value, "LaunchConfigId");
}

export function createTerminalId(value: number): TerminalId {
  return createNumericIdentifier(value, "TerminalId");
}

export function createTerminalStreamId(value: number): TerminalStreamId {
  return createNumericIdentifier(value, "TerminalStreamId");
}

export function createTmuxControllerId(value: number): TmuxControllerId {
  return createNumericIdentifier(value, "TmuxControllerId");
}

export function createTmuxWindowId(value: string): TmuxWindowId {
  if (!/^@\d+$/.test(value)) {
    throw new Error("TmuxWindowId must look like @1");
  }
  return value as TmuxWindowId;
}

export function createTmuxPaneId(value: string): TmuxPaneId {
  if (!/^%\d+$/.test(value)) {
    throw new Error("TmuxPaneId must look like %1");
  }
  return value as TmuxPaneId;
}
