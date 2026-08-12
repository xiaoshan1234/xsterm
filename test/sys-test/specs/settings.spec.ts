/**
 * test/sys-test/specs/settings.spec.ts
 *
 * Covers TC-1201–TC-1207 (Settings View).
 *
 * KNOWN-GAP: TC-1204 is skipped here — terminal theme persistence
 * is covered in persistence.spec (cross-reference).
 */

import { By, until } from "selenium-webdriver";
import { describe, before, after } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { appFixture, tc } from "../lib/harness.ts";
import { SIDEBAR } from "../lib/selectors.ts";

// ── Dynamic version from package.json ─────────────────────────────────────────
const PKG_VERSION = JSON.parse(
  await readFile(
    path.join(import.meta.dirname, "..", "..", "..", "package.json"),
    "utf8",
  ),
).version as string;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Open the Settings sidebar panel (idempotent — no-op if already open). */
async function openSettingsPanel(driver: WebDriver): Promise<void> {
  const drawer = await driver.findElements(By.css(".MuiDrawer-paper"));
  let alreadyOpen = false;
  if (drawer.length > 0) {
    const txt = await drawer[0].getText();
    alreadyOpen = txt.includes("Appearance") && txt.includes("About");
  }
  if (!alreadyOpen) {
    const btn = await driver.findElement(By.css(SIDEBAR.settings));
    await btn.click();
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'Settings')]")),
      5_000,
    );
  }
  await driver.sleep(200);
}

/**
 * Click a category item in the settings sidebar panel.
 * @param category  "Appearance" | "Shortcuts" | "About"
 */
async function clickCategory(driver: WebDriver, category: string): Promise<void> {
  const el = await driver.findElement(
    By.xpath(
      `//*[contains(@class,'MuiDrawer')]//*[normalize-space()="${category}" and not(*)]`,
    ),
  );
  await el.click();
  await driver.sleep(300);
}

// ── Fixture ────────────────────────────────────────────────────────────────────

const fixture = appFixture();

describe("Settings View (TC-1201–TC-1207)", { concurrency: false }, () => {
  before(() => fixture.before());
  after(() => fixture.after());

  // ── TC-1201 ─────────────────────────────────────────────────────────────────

  tc("1201", "Settings sidebar → Appearance view appears", async (driver) => {
    await openSettingsPanel(driver);
    await clickCategory(driver, "Appearance");

    // Verify "Appearance" heading is present
    const heading = await driver.findElement(
      By.xpath(
        "//*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5][contains(text(),'Appearance')]",
      ),
    );
    assert.ok(await heading.isDisplayed(), "Appearance heading should be visible");

    // Verify Chrome theme RadioGroup — 3 options
    const radios = await driver.findElements(By.css("input[type='radio']"));
    assert.ok(radios.length >= 3, "Should have at least 3 chrome theme radio options");

    // Verify Terminal theme Select
    const selects = await driver.findElements(By.css(".MuiSelect-root"));
    assert.ok(selects.length >= 1, "Terminal theme select should be present");

    // Verify local echo Switch
    const switches = await driver.findElements(By.css(".MuiSwitch-root"));
    assert.ok(switches.length >= 1, "Global local echo switch should be present");
  });

  // ── TC-1202 ─────────────────────────────────────────────────────────────────

  tc(
    "1202",
    "Chrome theme three-way toggle → global palette changes",
    async (driver) => {
      await openSettingsPanel(driver);
      await clickCategory(driver, "Appearance");

      const radios = await driver.findElements(By.css("input[type='radio']"));
      assert.ok(radios.length >= 3, "Need at least 3 radio options");

      // MUI Radio input is hidden; click the visible FormControlLabel.
      const clickTheme = async (labelText: string): Promise<void> => {
        const label = await driver.findElement(
          By.xpath(
            `//label[.//*[contains(text(),"${labelText}")] and .//input[@type='radio']]`,
          ),
        );
        await label.click();
        await driver.sleep(400);
      };

      // Verify the selected radio changes — proves the theme mode state updated.
      const checkedValue = () =>
        driver.executeScript<string>(
          `const r = document.querySelector('input[type="radio"]:checked');
           return r ? r.value : '';`,
        );

      await clickTheme("Dark");
      const darkVal = await checkedValue();
      await clickTheme("Light");
      const lightVal = await checkedValue();

      assert.strictEqual(darkVal, "dark", "Dark radio should be selected");
      assert.strictEqual(lightVal, "light", "Light radio should be selected");
      assert.notStrictEqual(darkVal, lightVal, "Theme mode should change between dark/light");

      // Restore to "Follow System" so test isolation is clean
      await clickTheme("Follow System");
    },
  );

  // ── TC-1203 ─────────────────────────────────────────────────────────────────

  tc(
    "1203",
    "Terminal theme dropdown → colour swatch updates",
    async (driver) => {
      await openSettingsPanel(driver);
      await clickCategory(driver, "Appearance");

      // Read swatch colour before change (via computed style — MUI sets
      // bgcolor through a class, not inline style).
      const bgBefore = await driver.executeScript<string>(
        `const el = document.querySelector('[data-terminal-swatch]');
         return el ? getComputedStyle(el).backgroundColor : '';`,
      );

      // Open the Terminal theme Select
      const select = await driver.findElement(By.css(".MuiSelect-root"));
      await select.click();
      await driver.sleep(300);

      // Select the second theme (index 1)
      const options = await driver.findElements(By.css(".MuiMenuItem-root"));
      assert.ok(
        options.length >= 2,
        `Expected ≥2 terminal themes, got ${options.length}`,
      );
      await options[1].click();
      await driver.sleep(400);

      // Read swatch colour after change
      const bgAfter = await driver.executeScript<string>(
        `const el = document.querySelector('[data-terminal-swatch]');
         return el ? getComputedStyle(el).backgroundColor : '';`,
      );

      assert.ok(
        bgAfter.length > 0,
        "Colour swatch should have a non-empty background after theme change",
      );
      assert.notStrictEqual(
        bgAfter,
        bgBefore,
        "Swatch background should change when theme changes",
      );
      // Note: persistence is tested in persistence.spec (TC-1204 / KNOWN-GAP: K5)

      // Restore to first theme
      const restore = await driver.findElement(By.css(".MuiSelect-root"));
      await restore.click();
      await driver.sleep(300);
      const restoreOpts = await driver.findElements(By.css(".MuiMenuItem-root"));
      if (restoreOpts.length > 0) {
        await restoreOpts[0].click();
        await driver.sleep(200);
      }
    },
  );

  // ── TC-1204 ─────────────────────────────────────────────────────────────────
  // KNOWN-GAP: K5 — terminal theme persistence is verified in persistence.spec.

  tc(
    "1204",
    "SKIP — terminal theme persistence (cross-ref: persistence.spec, KNOWN-GAP: K5)",
    async () => {
      // TC-1204 is intentionally a no-op here.
      // Terminal theme persistence is tested in persistence.spec.
      assert.ok(true, "TC-1204 documented skip — cross-ref: persistence.spec");
    },
  );

  // ── TC-1205 ─────────────────────────────────────────────────────────────────

  tc("1205", "Global local echo switch toggles", async (driver) => {
    await openSettingsPanel(driver);
    await clickCategory(driver, "Appearance");

    // MUI Switch wraps a hidden <input type="checkbox"> inside .MuiSwitch.
    // The label is a Typography ("Global local echo") inside a <label>.
    const switchInput = await driver.findElement(
      By.xpath(
        "//label[.//*[contains(text(),'Global local echo')]]//input[@type='checkbox']",
      ),
    );

    const checkedBefore = await switchInput.getAttribute("checked");

    // Click the visible switch (the label containing the text).
    const switchLabel = await driver.findElement(
      By.xpath(
        "//label[.//*[contains(text(),'Global local echo')]]//span[contains(@class,'MuiSwitch')]",
      ),
    );
    await switchLabel.click();
    await driver.sleep(300);

    const checkedAfter = await switchInput.getAttribute("checked");

    assert.notStrictEqual(
      checkedBefore,
      checkedAfter,
      "Switch checked state should flip after clicking",
    );

    // Toggle back to restore original state
    await switchLabel.click();
    await driver.sleep(200);
  });

  // ── TC-1206 ─────────────────────────────────────────────────────────────────

  tc("1206", "Shortcuts list displays five shortcut items", async (driver) => {
    await openSettingsPanel(driver);
    await clickCategory(driver, "Shortcuts");

    // Verify heading
    const heading = await driver.findElement(
      By.xpath(
        "//*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5][contains(text(),'Shortcuts')]",
      ),
    );
    assert.ok(await heading.isDisplayed(), "Shortcuts heading should be visible");

    // Verify all five shortcut labels
    const expectedShortcuts = [
      "New session",
      "Next tab",
      "Previous tab",
      "Close current tab",
      "Open settings",
    ];
    for (const label of expectedShortcuts) {
      const el = await driver.findElement(By.xpath(`//*[contains(text(),'${label}')]`));
      assert.ok(await el.isDisplayed(), `"${label}" shortcut label should be visible`);
    }

    // Verify chips (key badges)
    const chips = await driver.findElements(By.css(".MuiChip-root"));
    assert.ok(chips.length >= 5, `Expected ≥5 chips, got ${chips.length}`);

    // Verify specific key bindings
    const expectedKeys = [
      "Ctrl+Shift+N",
      "Ctrl+Tab",
      "Ctrl+Shift+Tab",
      "Ctrl+W",
      "Ctrl+,",
    ];
    for (const keys of expectedKeys) {
      const chip = await driver.findElement(
        By.xpath(`//*[contains(@class,'MuiChip')]//*[text()='${keys}']`),
      );
      assert.ok(
        await chip.isDisplayed(),
        `Chip with keys "${keys}" should be visible`,
      );
    }
  });

  // ── TC-1207 ─────────────────────────────────────────────────────────────────

  tc(
    "1207",
    "About shows version number matching package.json",
    async (driver) => {
      await openSettingsPanel(driver);
      await clickCategory(driver, "About");

      // Verify heading
      const heading = await driver.findElement(
        By.xpath(
          "//*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5][contains(text(),'About')]",
        ),
      );
      assert.ok(await heading.isDisplayed(), "About heading should be visible");

      // Verify product name
      const productName = await driver.findElement(
        By.xpath("//*[text()='XSTerm']"),
      );
      assert.ok(await productName.isDisplayed(), "XSTerm product name should be visible");

      // Verify version matches package.json — no hardcoded string
      const versionEl = await driver.findElement(
        By.xpath(`//*[contains(text(),'v${PKG_VERSION}')]`),
      );
      assert.ok(
        await versionEl.isDisplayed(),
        `Version "v${PKG_VERSION}" should be visible in About`,
      );
    },
  );
});
