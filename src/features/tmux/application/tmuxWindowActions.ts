import { tmuxCommands } from "../infrastructure";

export const tmuxWindowActions = {
  async createWindow(controllerId: number): Promise<void> {
    await tmuxCommands.createTmuxWindow(controllerId);
  },

  async killWindow(xstermWindowId: number): Promise<void> {
    await tmuxCommands.killTmuxWindow(xstermWindowId);
  },

  async renameWindow(xstermWindowId: number, name: string): Promise<void> {
    await tmuxCommands.renameTmuxWindow(xstermWindowId, name);
  },
};
