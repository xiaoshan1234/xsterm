import { tmuxCommands, toBackendControllerHandle, toBackendWindowHandle } from "../infrastructure";

export const tmuxWindowActions = {
  async createWindow(controllerId: number): Promise<void> {
    await tmuxCommands.createTmuxWindow(toBackendControllerHandle(controllerId));
  },

  async killWindow(xstermWindowId: number): Promise<void> {
    await tmuxCommands.killTmuxWindow(toBackendWindowHandle(xstermWindowId));
  },

  async renameWindow(xstermWindowId: number, name: string): Promise<void> {
    await tmuxCommands.renameTmuxWindow(toBackendWindowHandle(xstermWindowId), name);
  },
};
