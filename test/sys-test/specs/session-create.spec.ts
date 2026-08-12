/**
 * test/sys-test/specs/session-create.spec.ts
 *
 * TC-1301~1311: Create Session dialog
 *
 * TC-1301  Tab switching (Local Shell <-> SSH)
 * TC-1302  Create local session -> dialog closes, terminal ready
 * TC-1303  Save config OFF -> no new config persisted
 * TC-1304  Group selection
 * TC-1305  SSH empty fields -> error banner
 * TC-1306  Password <-> Key File auth switching
 * TC-1307  SSH unreachable host (127.0.0.1:2) -> dialog stays open + error
 * TC-1308  SSH advanced fields default values
 * TC-1309  Add Variable env var add/delete
 * TC-1310  Shell dropdown matches OS
 * TC-1311  Four close methods (X, Cancel, Escape, Backdrop)
 *
 * Cleanup: after() closes terminal panes and deletes saved configs
 * created by this spec so no residual state remains.
 */

import { By, Key, WebDriver, WebElement } from "selenium-webdriver";
import { describe, before, after } from "node:test";
import assert from "node:assert";

import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { SIDEBAR, DIALOG, TERMINAL, PANE, menuItem } from "../lib/selectors.ts";
import { waitForTerminalReady } from "../lib/terminal.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const T_SHORT = 5_000;
const T_MEDIUM = 10_000;
const T_LONG = 30_000;
const POLL = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure the Sessions sidebar drawer is open. */
async function ensureSidebarOpen(driver: WebDriver): Promise<void> {
  const drawers = await driver.findElements(By.css(".MuiDrawer-paper"));
  if (drawers.length > 0) return;
  const btn = await waitForElement(driver, SIDEBAR.sessions, { timeout: T_SHORT });
  await btn.click();
  await waitForElement(driver, ".MuiDrawer-paper", { timeout: T_SHORT });
}

/** Open the Create Session dialog via Sessions sidebar -> New Session. */
async function openCreateDialog(driver: WebDriver): Promise<void> {
  await ensureSidebarOpen(driver);
  const sidebar = await driver.findElement(By.css(".MuiDrawer-paper"));
  const newSessionBtn = await waitUntil(
    async () => {
      const els = await sidebar.findElements(
        By.xpath('.//button[contains(., "New Session")]')
      );
      return els.length > 0 ? els[0] : false;
    },
    { timeout: T_SHORT, interval: POLL, message: "New Session button not found" },
  );
  await newSessionBtn.click();
  await waitForElement(driver, DIALOG.root, { timeout: T_SHORT });
}

/** Wait for the Create Session dialog to disappear. */
async function waitUntilDialogGone(driver: WebDriver): Promise<void> {
  await waitUntil(
    async () => {
      const els = await driver.findElements(By.css(DIALOG.root));
      return els.length === 0;
    },
    { timeout: T_SHORT, interval: POLL, message: "Dialog did not close" },
  );
}

/** Close the dialog via the Cancel button. */
async function closeDialogCancel(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(
    By.xpath('//*[@role="dialog"]//button[contains(., "Cancel")]'),
  );
  await btn.click();
  await waitUntilDialogGone(driver);
}

/** Close the dialog via the X (aria-label="Close") button. */
async function closeDialogX(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css(DIALOG.close));
  await btn.click();
  await waitUntilDialogGone(driver);
}

/** Click a tab inside the Create Session dialog by its text. */
async function clickTab(driver: WebDriver, tabText: string): Promise<void> {
  const tab = await driver.findElement(
    By.xpath(`//*[@role="tab" and contains(., "${tabText}")]`),
  );
  await tab.click();
}

/** Check if a tab is selected (aria-selected="true"). */
async function isTabSelected(driver: WebDriver, tabText: string): Promise<boolean> {
  const tab = await driver.findElement(
    By.xpath(`//*[@role="tab" and contains(., "${tabText}")]`),
  );
  return (await tab.getAttribute("aria-selected")) === "true";
}

/** Fill a MUI TextField by its label text (select-all + type). */
async function fillTextField(
  driver: WebDriver,
  labelText: string,
  value: string,
): Promise<void> {
  const input = await driver.findElement(
    By.xpath(
      `//label[normalize-space(text())="${labelText}"]/ancestor::div[contains(@class,"MuiFormControl")]//input`,
    ),
  );
  await input.click();
  await input.sendKeys(Key.chord(Key.CONTROL, "a"), value);
}

/** Get the placeholder attribute of a MUI TextField by label text. */
async function getPlaceholder(
  driver: WebDriver,
  labelText: string,
): Promise<string> {
  const input = await driver.findElement(
    By.xpath(
      `//label[normalize-space(text())="${labelText}"]/ancestor::div[contains(@class,"MuiFormControl")]//input`,
    ),
  );
  return input.getAttribute("placeholder");
}

/** Get the value attribute of a MUI TextField by label text. */
async function getFieldValue(driver: WebDriver, labelText: string): Promise<string> {
  const input = await driver.findElement(
    By.xpath(
      `//label[normalize-space(text())="${labelText}"]/ancestor::div[contains(@class,"MuiFormControl")]//input`,
    ),
  );
  return input.getAttribute("value");
}

/** Open a MUI Select by its labelId and click the option with matching data-value. */
async function selectOption(
  driver: WebDriver,
  labelId: string,
  optionValue: string,
): Promise<void> {
  const sel = await driver.findElement(
    By.css(`[aria-labelledby="${labelId}"]`),
  );
  await sel.click();
  const opt = await waitUntil(
    async () => {
      const els = await driver.findElements(
        By.css(`[role="option"][data-value="${optionValue}"]`),
      );
      return els.length > 0 ? els[0] : false;
    },
    { timeout: 3_000, interval: POLL, message: `Option "${optionValue}" not found` },
  );
  await opt.click();
}

/** Open a MUI Select by its labelId and click the option with matching visible text. */
async function selectOptionByText(
  driver: WebDriver,
  labelId: string,
  optionText: string,
): Promise<void> {
  const sel = await driver.findElement(
    By.css(`[aria-labelledby="${labelId}"]`),
  );
  await sel.click();
  const opt = await waitUntil(
    async () => {
      const els = await driver.findElements(By.css('[role="option"]'));
      for (const el of els) {
        const text = (await el.getText()).trim();
        if (text === optionText) return el;
      }
      return false;
    },
    { timeout: 3_000, interval: POLL, message: `Option "${optionText}" not found` },
  );
  await opt.click();
}

/** Get the visible text of the currently selected option in a MUI Select. */
async function getSelectText(
  driver: WebDriver,
  labelId: string,
): Promise<string> {
  const sel = await driver.findElement(
    By.css(`[aria-labelledby="${labelId}"]`),
  );
  return (await sel.getText()).trim();
}

/** Wait for the error banner (a <p> with non-empty text inside the dialog). */
async function waitForErrorBanner(
  driver: WebDriver,
  timeout = T_SHORT,
): Promise<WebElement> {
  return waitUntil(
    async () => {
      const els = await driver.findElements(By.css('[role="dialog"] p'));
      for (const el of els) {
        if (await el.isDisplayed()) {
          const text = (await el.getText()).trim();
          if (text.length > 0) return el;
        }
      }
      return false;
    },
    { timeout, interval: POLL, message: "Error banner not found" },
  );
}

/** Close a terminal pane via context menu "Close Pane". */
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

/** Count saved session configs in the Sessions sidebar. */
async function countSavedConfigs(driver: WebDriver): Promise<number> {
  await ensureSidebarOpen(driver);
  const btns = await driver.findElements(
    By.css('[aria-label="close session"]'),
  );
  return btns.length;
}

/** Close all terminal panes and delete all saved configs (best-effort). */
async function cleanupAll(driver: WebDriver): Promise<void> {
  // 1. Close any open terminal panes
  for (let i = 0; i < 5; i++) {
    const panes = await driver.findElements(By.css(PANE.paneLeaf));
    if (panes.length === 0) break;
    try {
      await driver.actions().contextClick(panes[0]).perform();
      const closeItem = await waitUntil(
        async () => {
          const els = await driver.findElements(
            By.xpath(menuItem("Close Pane")),
          );
          return els.length > 0 ? els[0] : false;
        },
        { timeout: 3_000, interval: POLL, message: "Close Pane not found" },
      );
      await closeItem.click();
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      break;
    }
  }

  // 2. Delete all saved configs via Sessions sidebar
  try {
    await ensureSidebarOpen(driver);
    let closeBtns = await driver.findElements(
      By.css('[aria-label="close session"]'),
    );
    let attempts = 0;
    while (closeBtns.length > 0 && attempts < 20) {
      try {
        await closeBtns[0].click();
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        /* ignore */
      }
      closeBtns = await driver.findElements(
        By.css('[aria-label="close session"]'),
      );
      attempts++;
    }
  } catch {
    /* sidebar not available */
  }
}

// ── Fixture ───────────────────────────────────────────────────────────────────

const fixture = appFixture();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Create Session dialog (TC-1301~1311)", { concurrency: false }, () => {
  before(() => fixture.before());
  after(async () => {
    try {
      await cleanupAll(fixture.getDriver());
    } catch {
      /* best-effort */
    }
    await fixture.after();
  });

  // ── TC-1301: Tab switching ──────────────────────────────────────────────────

  tc("1301", "Tab switching -- Local Shell <-> SSH", async (driver) => {
    await openCreateDialog(driver);

    // "Local Shell" tab is selected by default
    assert.ok(
      await isTabSelected(driver, "Local Shell"),
      "Local Shell tab should be selected by default",
    );

    // Local form visible (Shell select exists)
    await waitForElement(driver, '[aria-labelledby="shell-select-label"]', {
      timeout: T_SHORT,
    });

    // Switch to SSH tab
    await clickTab(driver, "SSH");
    await waitUntil(
      async () => (await isTabSelected(driver, "SSH")) || false,
      { timeout: T_SHORT, message: "SSH tab not selected after click" },
    );

    // SSH form visible (Host field exists)
    await waitUntil(
      async () => {
        const els = await driver.findElements(
          By.xpath(
            '//label[normalize-space(text())="Host"]/ancestor::div[contains(@class,"MuiFormControl")]//input',
          ),
        );
        return els.length > 0 ? els[0] : false;
      },
      { timeout: T_SHORT, message: "Host field not found after switching to SSH" },
    );

    // Switch back to Local Shell
    await clickTab(driver, "Local Shell");
    await waitUntil(
      async () => (await isTabSelected(driver, "Local Shell")) || false,
      {
        timeout: T_SHORT,
        message: "Local Shell tab not selected after switching back",
      },
    );

    // Local form visible again
    await waitForElement(driver, '[aria-labelledby="shell-select-label"]', {
      timeout: T_SHORT,
    });

    await closeDialogCancel(driver);
  });

  // ── TC-1302: Create local session ───────────────────────────────────────────

  tc(
    "1302",
    "Create local session -> dialog closes, terminal ready",
    async (driver) => {
      await openCreateDialog(driver);

      // Click "Create" (Local Shell is default, Save config is ON by default)
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
      );
      await createBtn.click();

      // Dialog closes
      await waitUntilDialogGone(driver);

      // Terminal ready
      await waitForTerminalReady(driver, { timeout: T_MEDIUM });

      // At least one window tab exists
      const tabs = await driver.findElements(By.css('[role="tab"]'));
      assert.ok(tabs.length >= 1, "Should have at least one window tab");

      // Cleanup: close the terminal pane
      await closeTerminalPane(driver);
    },
  );

  // ── TC-1303: Save config OFF -> no new config ───────────────────────────────

  tc(
    "1303",
    "Save config OFF -> no new config persisted",
    async (driver) => {
      // Count saved configs before
      const beforeCount = await countSavedConfigs(driver);

      // Open Create Session dialog
      await openCreateDialog(driver);

      // Toggle "Save config" switch OFF
      const saveSwitch = await driver.findElement(
        By.xpath(
          '//span[contains(text(),"Save config")]/ancestor::label//input[@type="checkbox"]',
        ),
      );
      const checkedBefore = await saveSwitch.getAttribute("checked");
      // Click the visible switch track
      const switchTrack = await driver.findElement(
        By.xpath(
          '//span[contains(text(),"Save config")]/ancestor::label//span[contains(@class,"MuiSwitch")]',
        ),
      );
      await switchTrack.click();
      await waitUntil(
        async () => {
          const v = await saveSwitch.getAttribute("checked");
          return v !== checkedBefore;
        },
        { timeout: T_SHORT, message: "Save config switch did not toggle" },
      );

      // Click Create
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
      );
      await createBtn.click();

      // Dialog closes + terminal ready
      await waitUntilDialogGone(driver);
      await waitForTerminalReady(driver, { timeout: T_MEDIUM });

      // Count saved configs after -- should be unchanged
      const afterCount = await countSavedConfigs(driver);
      assert.strictEqual(
        afterCount,
        beforeCount,
        `Save config OFF should not persist a config (before=${beforeCount}, after=${afterCount})`,
      );

      // Cleanup: close the terminal pane
      await closeTerminalPane(driver);
    },
  );

  // ── TC-1304: Group selection ────────────────────────────────────────────────

  tc("1304", "Group selection", async (driver) => {
    // 1. Create a group via Sessions sidebar -> New Group
    await ensureSidebarOpen(driver);
    const newGroupBtn = await driver.findElement(
      By.xpath('//button[contains(., "New Group")]'),
    );
    await newGroupBtn.click();
    await waitForElement(driver, DIALOG.root, { timeout: T_SHORT });

    const groupName = "tc1304-test";
    const groupInput = await driver.findElement(
      By.css('input[placeholder="e.g., Work, Personal"]'),
    );
    await groupInput.sendKeys(groupName);

    const groupCreateBtn = await driver.findElement(
      By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
    );
    await groupCreateBtn.click();
    await waitUntilDialogGone(driver);

    // 2. Open Create Session dialog
    await openCreateDialog(driver);

    // 3. Open group dropdown and select the group
    await selectOptionByText(driver, "group-select-label", groupName);

    // 4. Verify the group is selected
    const selectedGroup = await getSelectText(driver, "group-select-label");
    assert.strictEqual(
      selectedGroup,
      groupName,
      `Group "${groupName}" should be selected`,
    );

    // 5. Close dialog
    await closeDialogCancel(driver);

    // 6. Cleanup: delete the group via right-click -> Delete
    await ensureSidebarOpen(driver);
    const groupHeader = await waitUntil(
      async () => {
        const els = await driver.findElements(
          By.xpath(
            `//*[contains(text(),"${groupName}")]/ancestor::div[contains(@class,"MuiListItemButton")]`,
          ),
        );
        return els.length > 0 ? els[0] : false;
      },
      { timeout: T_SHORT, message: "Group header not found" },
    );
    await driver.actions().contextClick(groupHeader).perform();
    const deleteItem = await waitUntil(
      async () => {
        const els = await driver.findElements(By.xpath(menuItem("Delete")));
        return els.length > 0 ? els[0] : false;
      },
      { timeout: 3_000, interval: POLL, message: "Delete menu item not found" },
    );
    await deleteItem.click();
  });

  // ── TC-1305: SSH empty fields -> error banner ───────────────────────────────

  tc("1305", "SSH empty fields -> error banner", async (driver) => {
    await openCreateDialog(driver);

    // Switch to SSH tab
    await clickTab(driver, "SSH");
    await waitUntil(
      async () => (await isTabSelected(driver, "SSH")) || false,
      { timeout: T_SHORT, message: "SSH tab not selected" },
    );

    // Click Create without filling any fields
    const createBtn = await driver.findElement(
      By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
    );
    await createBtn.click();

    // Error banner appears
    const banner = await waitForErrorBanner(driver, T_SHORT);
    const text = (await banner.getText()).trim();
    assert.ok(
      text.length > 0,
      "Error banner should have non-empty text for empty SSH fields",
    );

    // Dialog stays open
    const dialogs = await driver.findElements(By.css(DIALOG.root));
    assert.ok(dialogs.length > 0, "Dialog should stay open on validation error");

    await closeDialogCancel(driver);
  });

  // ── TC-1306: Password <-> Key File auth switching ───────────────────────────

  tc(
    "1306",
    "Password <-> Key File auth switching",
    async (driver) => {
      await openCreateDialog(driver);
      await clickTab(driver, "SSH");
      await waitUntil(
        async () => (await isTabSelected(driver, "SSH")) || false,
        { timeout: T_SHORT, message: "SSH tab not selected" },
      );

      // Default auth = Password
      const authText1 = await getSelectText(driver, "auth-select-label");
      assert.strictEqual(authText1, "Password", "Default auth should be Password");

      // Password field exists
      await waitUntil(
        async () => {
          const els = await driver.findElements(
            By.xpath(
              '//label[normalize-space(text())="Password"]/ancestor::div[contains(@class,"MuiFormControl")]//input',
            ),
          );
          return els.length > 0 ? els[0] : false;
        },
        { timeout: T_SHORT, message: "Password field not found" },
      );

      // Switch to Key File
      await selectOption(driver, "auth-select-label", "key");
      const authText2 = await getSelectText(driver, "auth-select-label");
      assert.strictEqual(authText2, "Key File", "Auth should be Key File");

      // Key File Path field exists
      await waitUntil(
        async () => {
          const els = await driver.findElements(
            By.xpath(
              '//label[normalize-space(text())="Key File Path"]/ancestor::div[contains(@class,"MuiFormControl")]//input',
            ),
          );
          return els.length > 0 ? els[0] : false;
        },
        { timeout: T_SHORT, message: "Key File Path field not found" },
      );

      // Passphrase field exists
      await waitUntil(
        async () => {
          const els = await driver.findElements(
            By.xpath(
              '//label[contains(text(),"Passphrase")]/ancestor::div[contains(@class,"MuiFormControl")]//input',
            ),
          );
          return els.length > 0 ? els[0] : false;
        },
        { timeout: T_SHORT, message: "Passphrase field not found" },
      );

      // Switch back to Password
      await selectOption(driver, "auth-select-label", "password");
      const authText3 = await getSelectText(driver, "auth-select-label");
      assert.strictEqual(authText3, "Password", "Auth should be Password again");

      // Password field exists again
      await waitUntil(
        async () => {
          const els = await driver.findElements(
            By.xpath(
              '//label[normalize-space(text())="Password"]/ancestor::div[contains(@class,"MuiFormControl")]//input',
            ),
          );
          return els.length > 0 ? els[0] : false;
        },
        { timeout: T_SHORT, message: "Password field not found after switching back" },
      );

      await closeDialogCancel(driver);
    },
  );

  // ── TC-1307: SSH unreachable host (127.0.0.1:2) ──────────────────────────────

  tc(
    "1307",
    "SSH unreachable host (127.0.0.1:2) -> dialog stays open + error",
    async (driver) => {
      await openCreateDialog(driver);
      await clickTab(driver, "SSH");
      await waitUntil(
        async () => (await isTabSelected(driver, "SSH")) || false,
        { timeout: T_SHORT, message: "SSH tab not selected" },
      );

      // Fill SSH form: 127.0.0.1:2, testuser, testpass
      await fillTextField(driver, "Host", "127.0.0.1");
      await fillTextField(driver, "Port", "2");
      await fillTextField(driver, "Username", "testuser");
      await fillTextField(driver, "Password", "testpass");

      // Set Connection Timeout to 5s to ensure fast failure
      await fillTextField(driver, "Connection Timeout (seconds)", "5");

      // Click Create
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]'),
      );
      await createBtn.click();

      // Wait for error banner (30s timeout per spec requirement)
      const banner = await waitForErrorBanner(driver, T_LONG);
      const text = (await banner.getText()).trim();
      assert.ok(text.length > 0, "Error banner should appear for unreachable host");

      // Dialog stays open
      const dialogs = await driver.findElements(By.css(DIALOG.root));
      assert.ok(
        dialogs.length > 0,
        "Dialog should stay open when SSH connection fails",
      );

      await closeDialogCancel(driver);
    },
  );

  // ── TC-1308: SSH advanced fields default values ──────────────────────────────

  tc("1308", "SSH advanced fields default values", async (driver) => {
    await openCreateDialog(driver);
    await clickTab(driver, "SSH");
    await waitUntil(
      async () => (await isTabSelected(driver, "SSH")) || false,
      { timeout: T_SHORT, message: "SSH tab not selected" },
    );

    // Terminal Type default = xterm-256color
    const termType = await getSelectText(driver, "term-select-label");
    assert.ok(
      termType.includes("xterm-256color"),
      `Terminal Type should default to xterm-256color, got "${termType}"`,
    );

    // Initial Rows placeholder = "24"
    const rowsPh = await getPlaceholder(driver, "Initial Rows");
    assert.strictEqual(rowsPh, "24", 'Initial Rows placeholder should be "24"');

    // Initial Cols placeholder = "80"
    const colsPh = await getPlaceholder(driver, "Initial Cols");
    assert.strictEqual(colsPh, "80", 'Initial Cols placeholder should be "80"');

    // Keepalive Interval placeholder = "(disabled)"
    const kaPh = await getPlaceholder(driver, "Keepalive Interval (seconds)");
    assert.strictEqual(
      kaPh,
      "(disabled)",
      'Keepalive Interval placeholder should be "(disabled)"',
    );

    // Connection Timeout placeholder = "(no timeout)"
    const ctPh = await getPlaceholder(driver, "Connection Timeout (seconds)");
    assert.strictEqual(
      ctPh,
      "(no timeout)",
      'Connection Timeout placeholder should be "(no timeout)"',
    );

    // Enable Compression switch = OFF
    const compSwitch = await driver.findElement(
      By.xpath(
        '//span[contains(text(),"Enable Compression")]/ancestor::label//input[@type="checkbox"]',
      ),
    );
    const checked = await compSwitch.getAttribute("checked");
    assert.notStrictEqual(
      checked,
      "true",
      "Enable Compression should be OFF by default",
    );

    await closeDialogCancel(driver);
  });

  // ── TC-1309: Add Variable env var add/delete ────────────────────────────────

  tc("1309", "Add Variable env var add/delete", async (driver) => {
    await openCreateDialog(driver);

    // No env var rows initially (no KEY input)
    let keyInputs = await driver.findElements(By.css('input[placeholder="KEY"]'));
    assert.strictEqual(
      keyInputs.length,
      0,
      "No env var rows should exist initially",
    );

    // Click "Add Variable"
    const addBtn = await driver.findElement(
      By.xpath('//button[contains(., "Add Variable")]'),
    );
    await addBtn.click();

    // One env var row appears
    keyInputs = await driver.findElements(By.css('input[placeholder="KEY"]'));
    assert.strictEqual(keyInputs.length, 1, "One env var row should appear");

    const valueInputs = await driver.findElements(
      By.css('input[placeholder="VALUE"]'),
    );
    assert.strictEqual(valueInputs.length, 1, "One VALUE input should appear");

    // Type in KEY and VALUE
    await keyInputs[0].sendKeys("MY_VAR");
    await valueInputs[0].sendKeys("my_value");

    // Verify values
    assert.strictEqual(
      await keyInputs[0].getAttribute("value"),
      "MY_VAR",
      "KEY input should contain MY_VAR",
    );
    assert.strictEqual(
      await valueInputs[0].getAttribute("value"),
      "my_value",
      "VALUE input should contain my_value",
    );

    // Delete the env var row (click the IconButton with DeleteIcon)
    const deleteIcon = await driver.findElement(
      By.css('[data-testid="DeleteIcon"]'),
    );
    const deleteBtn = await deleteIcon.findElement(
      By.xpath("./ancestor::button"),
    );
    await deleteBtn.click();

    // Row disappears
    await waitUntil(
      async () => {
        const els = await driver.findElements(
          By.css('input[placeholder="KEY"]'),
        );
        return els.length === 0;
      },
      { timeout: T_SHORT, message: "Env var row did not disappear after delete" },
    );

    await closeDialogCancel(driver);
  });

  // ── TC-1310: Shell dropdown matches OS ──────────────────────────────────────

  tc("1310", "Shell dropdown matches OS", async (driver) => {
    await openCreateDialog(driver);

    // Local Shell tab is default
    assert.ok(
      await isTabSelected(driver, "Local Shell"),
      "Local Shell tab should be selected",
    );

    // Open Shell dropdown
    const shellSelect = await driver.findElement(
      By.css('[aria-labelledby="shell-select-label"]'),
    );
    await shellSelect.click();

    // Get all option texts
    const options = await waitUntil(
      async () => {
        const els = await driver.findElements(By.css('[role="option"]'));
        if (els.length === 0) return false;
        const texts = await Promise.all(els.map((el) => el.getText()));
        return texts;
      },
      { timeout: 3_000, interval: POLL, message: "Shell options not found" },
    );

    // On Windows (Tauri webview), expect PowerShell and CMD options
    const optionTexts = options.map((t) => t.trim());
    assert.ok(
      optionTexts.some((t) => t.includes("PowerShell")),
      `Shell options should include PowerShell on Windows, got: ${optionTexts.join(", ")}`,
    );
    assert.ok(
      optionTexts.some((t) => t.includes("CMD")),
      `Shell options should include CMD on Windows, got: ${optionTexts.join(", ")}`,
    );

    // Close dropdown
    await driver.actions().sendKeys(Key.ESCAPE).perform();

    await closeDialogCancel(driver);
  });

  // ── TC-1311: Four close methods ──────────────────────────────────────────────

  tc("1311", "Four close methods (X, Cancel, Escape, Backdrop)", async (driver) => {
    // Method 1: X button
    await openCreateDialog(driver);
    await closeDialogX(driver);

    // Method 2: Cancel button
    await openCreateDialog(driver);
    await closeDialogCancel(driver);

    // Method 3: Escape key
    await openCreateDialog(driver);
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await waitUntilDialogGone(driver);

    // Method 4: Backdrop click
    await openCreateDialog(driver);
    await driver.executeScript(
      "document.querySelector('.MuiBackdrop-root').click();",
    );
    await waitUntilDialogGone(driver);
  });
});
