import { describe, expect, it } from "vitest";
import { type SavedTerminalConfig, type TerminalGroup } from "../../../models/legacy/terminal";
import { selectTerminalManagerGroups } from "./managerViewModel";

const savedConfigs: SavedTerminalConfig[] = [
  {
    id: "local-1",
    name: "Local PowerShell",
    version: 1,
    type: "local",
    config: { shellTemplate: "powershell" },
  },
  {
    id: "ssh-1",
    name: "Production SSH",
    version: 1,
    type: "ssh",
    config: {
      host: "example.com",
      port: 22,
      username: "deploy",
      auth_type: "password",
    },
  },
  {
    id: "tmux-1",
    name: "tmux dev",
    version: 1,
    type: "tmux-pane",
    config: { baseConfigId: "local-1" },
  },
];

const groups: TerminalGroup[] = [
  { id: 0, name: "Ungrouped", configIds: [], collapsed: false },
  { id: 1, name: "Work", configIds: ["ssh-1"], collapsed: false },
];

describe("terminal view models", () => {
  it("keeps tmux configs out of the terminal config manager and groups", () => {
    const result = selectTerminalManagerGroups(savedConfigs, groups);

    expect(result[0].items.map((item) => item.configId)).toEqual(["local-1"]);
    expect(result[1].items.map((item) => item.configId)).toEqual(["ssh-1"]);
    expect(result.flatMap((group) => group.items).some((item) => item.configId === "tmux-1")).toBe(
      false,
    );
  });
});
