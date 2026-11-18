import { subscribeTmuxEvents, type TmuxEventHandlers } from "../infrastructure";

export const tmuxEventStream = {
  subscribe(handlers: TmuxEventHandlers): Promise<() => void> {
    return subscribeTmuxEvents(handlers);
  },
};
