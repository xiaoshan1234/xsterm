import {
  createTerminalStreamId,
  createTmuxPaneId,
  type TerminalStreamId,
  type TmuxPaneId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { createConnectingStatus, type TerminalStatus } from "../terminal/TerminalStatus";

export interface TmuxPane {
  readonly kind: "tmux-pane";
  readonly id: TmuxPaneId;
  readonly streamId: TerminalStreamId;
  readonly status: TerminalStatus;
}

export interface CreateTmuxPaneInput {
  id: string;
  streamId: number;
  status?: TerminalStatus;
}

export function createTmuxPane(input: CreateTmuxPaneInput): ModelResult<TmuxPane> {
  try {
    return modelSuccess({
      kind: "tmux-pane",
      id: createTmuxPaneId(input.id),
      streamId: createTerminalStreamId(input.streamId),
      status: input.status ?? createConnectingStatus(),
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid tmux pane id",
    );
  }
}
