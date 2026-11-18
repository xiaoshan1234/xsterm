import { describe, expect, it } from "vitest";
import { filterTerminalInput } from "./terminalInput";

describe("filterTerminalInput", () => {
  it("preserves xterm device-attributes replies for non-tmux terminals", () => {
    expect(filterTerminalInput("local", "\x1b[?1;2c")).toBe("\x1b[?1;2c");
    expect(filterTerminalInput("ssh", "\x1b[?1;2c")).toBe("\x1b[?1;2c");
  });

  it("removes the device-attributes reply generated for a tmux pane", () => {
    expect(filterTerminalInput("tmux-pane", "\x1b[?1;2c")).toBe("");
  });

  it("keeps ordinary input combined with a device-attributes reply", () => {
    expect(filterTerminalInput("tmux-pane", "a\x1b[?1;2cb")).toBe("ab");
  });
});
