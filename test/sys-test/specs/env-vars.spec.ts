/**
 * test/sys-test/specs/env-vars.spec.ts
 *
 * TC-1401~1402: Environment variables actually reach the spawned PTY shell.
 *
 * TC-1401  Single env var (XSTERM_TEST_VAR=xsterm_test_value_xyz) added in the
 *          Shell settings sidebar is delivered to the spawned PTY. After Create,
 *          the shell echoes the value back when we run `echo $XSTERM_TEST_VAR`.
 *
 * TC-1402  Multiple env vars added in the Shell settings sidebar all reach the
 *          shell — neither var is dropped, neither value is overwritten.
 *
 * Background (regression test):
 *   Previously the chain "user adds env var in ShellSettingsPanel → IPC → Rust
 *   backend → CommandBuilder → spawned shell" was silently broken — no test
 *   covered the propagation path and ShellSettingsPanel had no defensive state
 *   sync. The unit test `create_local_with_env_config_applies_env_to_command_builder`
 *   covers backend up to CommandBuilder; ShellSettingsPanel got a defensive
 *   useEffect to re-derive envVars from localConfig; and LocalSessionForm (dead
 *   duplicate env-var editor) was deleted. This spec validates the full chain
 *   end-to-end including the PTY spawn.
 *
 * Cleanup: after() closes the terminal pane created by this spec.
 */

import { By, WebDriver } from "selenium-webdriver";
import { describe, before, after } from "node:test";
import assert from "node:assert";

import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { DIALOG, TERMINAL, PANE, menuItem } from "../lib/selectors.ts";
import {
  typeInTerminal,
  assertTerminalContains,
  waitForTerminalReady,
} from "../lib/terminal.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const T_SHORT = 5_000;
const T_MEDIUM = 10_000;
const POLL = 200;

// Env var values for TC-1401. Chosen to be unique strings that are very
// unlikely to appear elsewhere in the terminal's initial banner.
const ENV_KEY_1 = "XSTERM_TEST_VAR";
const ENV_VALUE_1 = "xsterm_test_value_xyz";

// Env var values for TC-1402 — two distinct pairs to verify neither is dropped.
const ENV_KEY_A = "XSTERM_TEST_A";
const ENV_VALUE_A = "xsterm_value_alpha";
const ENV_KEY_B = "XSTERM_TEST_B";
const ENV_VALUE_B = "xsterm_value_beta";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Open the Create Session dialog via Sessions sidebar → New Session. */
async function openCreateDialog(driver: WebDriver): Promise<void> {
  // Ensure the Sessions drawer is open.
  const drawers = await driver.findElements(By.css(".MuiDrawer-paper"));
  if (drawers.length === 0) {
    const btn = await waitForElement(driver, '[aria-label="Sessions"]', {
      timeout: T_SHORT,
    });
    await btn.click();
    await waitForElement(driver, ".MuiDrawer-paper", { timeout: T_SHORT });
  }

  const sidebar = await driver.findElement(By.css(".MuiDrawer-paper"));
  const newSessionBtn = await waitUntil(
    async () => {
      const els = await sidebar.findElements(
        By.xpath('.//button[contains(., "New Session")]'),
      );
      return els.length > 0 ? els[0] : false;
    },
    { timeout: T_SHORT, interval: POLL, message: "New Session button not found" },
  );
  await newSessionBtn.click();
  await waitForElement(driver, DIALOG.root, { timeout: T_SHORT });
}

/**
 * Click the "Shell" sidebar item inside the CreateSessionDialog.
 *
 * The dialog has two distinct elements whose visible text is "Shell":
 *   - the top tab (class `dialog-tab`) — switches between Local/SSH
 *   - the sidebar item (`<div role="button">` with class `dialog-sidebar-item`)
 *     — opens ShellSettingsPanel
 *
 * Scope to the dialog sidebar (`<nav class="dialog-sidebar">`) and match the
 * div that has role="button" and a label span of exactly "Shell". The icon
 * span holds an SVG, no text, so normalize-space() on the div body would also
 * work, but the span-text match is unambiguous.
 *
 * Source: src/components/dialogs/SessionFormLayout.tsx:43-62 (sidebar markup)
 */
async function clickShellSidebarItem(driver: WebDriver): Promise<void> {
  const sidebarItem = await waitUntil(
    async () => {
      const els = await driver.findElements(
        By.xpath(
          '//*[contains(@class,"dialog-sidebar")]' +
            '//div[@role="button"]' +
            '[.//span[normalize-space()="Shell"]]',
        ),
      );
      return els.length > 0 ? els[0] : false;
    },
    {
      timeout: T_SHORT,
      interval: POLL,
      message:
        'Sidebar "Shell" item not found inside dialog ' +
        '(scoped to .dialog-sidebar)',
    },
  );
  await sidebarItem.click();
}

/** Close the open terminal pane via right-click → "Close Pane". */
async function closeTerminalPane(driver: WebDriver): Promise<void> {
  const panes = await driver.findElements(By.css(PANE.paneLeaf));
  if (panes.length === 0) return;
  await driver.actions().contextClick(panes[0]).perform();
  const closeItem = await waitUntil(
    async () => {
      const els = await driver.findElements(By.xpath(menuItem("Close Pane")));
      return els.length > 0 ? els[0] : false;
    },
    { timeout: 3_000, interval: POLL, message: "Close Pane menu item not found" },
  );
  await closeItem.click();
  await waitUntil(
    async () => {
      const els = await driver.findElements(By.css(TERMINAL.rows));
      return els.length === 0;
    },
    { timeout: T_SHORT, interval: POLL, message: "Terminal did not disappear" },
  );
}

/** Best-effort cleanup for any panes left behind. */
async function cleanup(driver: WebDriver): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const panes = await driver.findElements(By.css(PANE.paneLeaf));
    if (panes.length === 0) break;
    try {
      await closeTerminalPane(driver);
    } catch {
      break;
    }
  }
}

// ── Fixture ───────────────────────────────────────────────────────────────────

const fixture = appFixture();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Env vars reach PTY shell (TC-1401~)", { concurrency: false }, () => {
  before(() => fixture.before());
  after(async () => {
    try {
      await cleanup(fixture.getDriver());
    } catch {
      /* best-effort */
    }
    await fixture.after();
  });

  // ── TC-1401: Single env var reaches the spawned PTY shell ──────────────────

  tc(
    "1401",
    "Env vars reach spawned PTY shell",
    async (driver) => {
      // 1. Open the CreateSessionDialog via Sessions sidebar → New Session.
      await openCreateDialog(driver);

      // 2. Local Shell tab is selected by default; navigate to Shell sidebar.
      //    Local Shell is the top tab (text "Shell"), ShellSettingsPanel is
      //    the sidebar item (text "Shell"). openCreateDialog defaults to the
      //    "session" sidebar item; we need to switch to "shell".
      await clickShellSidebarItem(driver);

      // 3. Verify ShellSettingsPanel is rendered — no env var rows initially.
      let keyInputs = await driver.findElements(
        By.css('input[placeholder="KEY"]'),
      );
      assert.strictEqual(
        keyInputs.length,
        0,
        "ShellSettingsPanel should render with no env var rows initially",
      );

      // 4. Click "Add Variable" to create one env var row.
      const addBtn = await driver.findElement(
        By.xpath('//button[contains(., "Add Variable")]'),
      );
      await addBtn.click();

      // 5. Fill KEY=XSTERM_TEST_VAR, VALUE=xsterm_test_value_xyz.
      keyInputs = await driver.findElements(
        By.css('input[placeholder="KEY"]'),
      );
      assert.strictEqual(keyInputs.length, 1, "One env var row should appear");
      const valueInputs = await driver.findElements(
        By.css('input[placeholder="VALUE"]'),
      );
      assert.strictEqual(
        valueInputs.length,
        1,
        "One VALUE input should appear",
      );
      await keyInputs[0].sendKeys(ENV_KEY_1);
      await valueInputs[0].sendKeys(ENV_VALUE_1);

      // Sanity check — values landed in the inputs.
      assert.strictEqual(
        await keyInputs[0].getAttribute("value"),
        ENV_KEY_1,
        "KEY input should contain the typed key",
      );
      assert.strictEqual(
        await valueInputs[0].getAttribute("value"),
        ENV_VALUE_1,
        "VALUE input should contain the typed value",
      );

      // 6. Click "Create" (scoped to the dialog to avoid stray matches).
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
      );
      await createBtn.click();

      // 7. Wait for terminal ready (.xterm-rows + textarea + non-empty prompt).
      await waitForTerminalReady(driver, { timeout: T_MEDIUM });

      // 8. Type `echo $XSTERM_TEST_VAR` into the terminal (typeInTerminal
      //    appends ENTER by default).
      await typeInTerminal(driver, `echo $${ENV_KEY_1}`);

      // 9. Poll terminal text until it contains the value.
      //    Timeout 5s — once the PTY is up, the round-trip is fast.
      await assertTerminalContains(driver, ENV_VALUE_1, { timeout: T_SHORT });

      // 10. Cleanup: close the terminal pane (same pattern as
      //     session-create.spec.ts closeTerminalPane).
      await closeTerminalPane(driver);
    },
  );

  // ── TC-1402: Multiple env vars all reach the spawned PTY shell ──────────────

  tc(
    "1402",
    "Multiple env vars all reach shell",
    async (driver) => {
      // 1. Open the CreateSessionDialog.
      await openCreateDialog(driver);

      // 2. Navigate to Shell sidebar.
      await clickShellSidebarItem(driver);

      // 3. Click "Add Variable" twice to create two env var rows.
      const addBtn = await driver.findElement(
        By.xpath('//button[contains(., "Add Variable")]'),
      );
      await addBtn.click();
      await addBtn.click();

      // 4. Fill two rows: VAR_A=alpha, VAR_B=beta.
      let keyInputs = await driver.findElements(
        By.css('input[placeholder="KEY"]'),
      );
      let valueInputs = await driver.findElements(
        By.css('input[placeholder="VALUE"]'),
      );
      assert.strictEqual(
        keyInputs.length,
        2,
        "Two env var rows should appear after two Add Variable clicks",
      );
      assert.strictEqual(
        valueInputs.length,
        2,
        "Two VALUE inputs should appear after two Add Variable clicks",
      );
      await keyInputs[0].sendKeys(ENV_KEY_A);
      await valueInputs[0].sendKeys(ENV_VALUE_A);
      await keyInputs[1].sendKeys(ENV_KEY_B);
      await valueInputs[1].sendKeys(ENV_VALUE_B);

      // 5. Click "Create" (scoped to the dialog).
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
      );
      await createBtn.click();

      // 6. Wait for terminal ready.
      await waitForTerminalReady(driver, { timeout: T_MEDIUM });

      // 7. Type `echo $XSTERM_TEST_A $XSTERM_TEST_B` — single line so we
      //    see both values adjacent and can grep the combined output.
      await typeInTerminal(driver, `echo $${ENV_KEY_A} $${ENV_KEY_B}`);

      // 8. Both values must appear in the terminal output.
      await assertTerminalContains(driver, ENV_VALUE_A, { timeout: T_SHORT });
      await assertTerminalContains(driver, ENV_VALUE_B, { timeout: T_SHORT });

      // 9. Cleanup: close the terminal pane.
      await closeTerminalPane(driver);
    },
  );
});