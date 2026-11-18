export type SplitDirection = "horizontal" | "vertical";

export interface PaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: SplitDirection;
  size: number;
  children?: PaneNode[];
  terminalId?: number;
  configId?: string;
}
