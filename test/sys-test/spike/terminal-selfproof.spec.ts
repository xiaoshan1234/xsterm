/**
 * TEMPORARY self-proof spec for terminal.ts (Task 4).
 * Verifies the input → read → assert loop and the timeout error path.
 * DELETE after verification passes.
 *
 * Run:
 *   node --experimental-strip-types --test test/sys-test/spike/terminal-selfproof.spec.ts
 *
 * Preconditions:
 *   - Vite dev server on :1420 (npm run dev, on Windows)
 *   - tauri-driver on :4444 (scripts/windows/start-webdriver.ps1)
 */
import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appFixture } from "../lib/harness.ts";
import {
  typeInTerminal,
  assertTerminalContains,
  createLocalSessionViaUI,
  readTerminalText,
} from "../lib/terminal.ts";

const EVIDENCE_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".omo",
  "evidence"
);

const fixture = appFixture();

describe("terminal.ts self-proof (TEMPORARY)", () => {
  before(() => fixture.before());
  after(() => fixture.after());

  it("loop: create session → echo MARK_<rand> → assertTerminalContains hits", async () => {
    const driver = fixture.getDriver();
    const marker = "MARK_" + Math.floor(Math.random() * 1_000_000);

    // 1. Create a local session via UI (waits for terminal ready internally)
    await createLocalSessionViaUI(driver);

    // 2. Type echo command with marker
    await typeInTerminal(driver, `echo ${marker}`);

    // 3. Poll-assert the marker appears in terminal output (5s timeout)
    await assertTerminalContains(driver, marker, { timeout: 5_000 });

    // Evidence: success
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const text = await readTerminalText(driver);
    await writeFile(
      path.join(EVIDENCE_DIR, "task-4-terminal-loop.txt"),
      `PASS: marker "${marker}" found in terminal within 5s\n` +
        `Terminal text excerpt (first 300 chars):\n${text.slice(0, 300)}\n`
    );
  });

  it("timeout: assertTerminalContains throws with terminal text snapshot", async () => {
    const driver = fixture.getDriver();
    let threw = false;
    let errMsg = "";

    try {
      await assertTerminalContains(driver, "NEVER_APPEARS_XYZ", {
        timeout: 1_500,
      });
    } catch (e) {
      threw = true;
      errMsg = e instanceof Error ? e.message : String(e);
    }

    assert.ok(threw, "assertTerminalContains should have thrown on timeout");
    assert.ok(
      errMsg.includes("NEVER_APPEARS_XYZ"),
      "error message should mention the missing substring"
    );
    assert.ok(
      errMsg.includes("Last terminal text"),
      "error message should include terminal text snapshot"
    );

    // Evidence: timeout path verified
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(
      path.join(EVIDENCE_DIR, "task-4-terminal-timeout.txt"),
      `PASS: timeout threw as expected\n` +
        `Error message:\n${errMsg}\n`
    );
  });
});
