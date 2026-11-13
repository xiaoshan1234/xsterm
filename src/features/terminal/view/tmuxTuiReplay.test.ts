/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

const openTerminals: Terminal[] = [];

afterEach(() => {
  for (const terminal of openTerminals.splice(0)) {
    terminal.dispose();
  }
});

describe("tmux TUI replay", () => {
  it("restores alternate-screen rendering and mouse tracking modes", async () => {
    const terminal = new Terminal({ cols: 40, rows: 10 });
    openTerminals.push(terminal);

    const replayPayload =
      "shell\r\n" +
      "\u001b[?1049h" +
      "\u001b[2J\u001b[H" +
      "XSTERM_FAKE_TUI_READY\r\n" +
      "WHEEL_EVENTS=0" +
      "\u001b[?1003h\u001b[?1006h\u001b[4;1H";

    await new Promise<void>((resolve) => {
      terminal.write(replayPayload, resolve);
    });

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toContain(
      "XSTERM_FAKE_TUI_READY",
    );
    expect(terminal.modes.mouseTrackingMode).toBe("any");
    expect(terminal.modes.wraparoundMode).toBe(true);
  });
});
