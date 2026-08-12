/**
 * test/sys-test/specs/window.spec.ts
 *
 * TC-101~107: Title bar & window controls
 *
 * TC-101  Minimize button
 * TC-102  Maximize button
 * TC-103  Restore button (after maximize)
 * TC-104  Maximize/Restore aria-label sync with window state
 * TC-105  Close exits the app         ← last (kills the session)
 * TC-106  Title bar drag               ← skip: WebDriver cannot drive native drag
 * TC-107  Title bar display            ← logo + ~28px height
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { NAV } from "../lib/selectors.ts";

const fixture = appFixture();

describe("Title bar & window controls (TC-101~107)", () => {
  before(() => fixture.before());
  after(() => fixture.after());

  // TC-101: Minimize button
  tc("101", "Minimize button — click does not throw", async (driver) => {
    const btn = await waitForElement(driver, NAV.minimize, {
      visible: true,
    });
    // Clicking minimize must not throw; taskbar icon is hidden from WebDriver.
    // Note: unminimize/maximize via __TAURI_INTERNALS__ are not callable from
    // the webview (capability grant is for Rust-side only). The minimize click
    // itself is the core assertion; we trust the after() cleanup.
    await btn.click();
  });

  // TC-102: Maximize button
  tc("102", "Maximize button — window dimensions increase", async (driver) => {
    const before: { width: number; height: number } = await driver.executeScript(
      "return { width: window.innerWidth, height: window.innerHeight }"
    );

    const btn = await waitForElement(driver, NAV.maximizeRestore, {
      visible: true,
    });
    await btn.click();

    // Wait for the maximize to take effect (Tauri async).
    await waitUntil(
      async () => {
        const dims: { width: number; height: number } = await driver.executeScript(
          "return { width: window.innerWidth, height: window.innerHeight }"
        );
        return dims.width > before.width || dims.height > before.height ? dims : false;
      },
      { timeout: 5_000, message: "Window did not expand after maximize" }
    );
  });

  // TC-103: Restore button — back to pre-maximize size
  tc(
    "103",
    "Restore button — window dimensions return to pre-maximize size",
    async (driver) => {
      // Capture the currently-maximized dimensions as the baseline to restore to.
      const maximized: { width: number; height: number } = await driver.executeScript(
        "return { width: window.innerWidth, height: window.innerHeight }"
      );

      const btn = await waitForElement(driver, NAV.maximizeRestore, {
        visible: true,
      });
      await btn.click();

      // The restored window should be strictly smaller than the maximized state.
      await waitUntil(
        async () => {
          const dims: { width: number; height: number } = await driver.executeScript(
            "return { width: window.innerWidth, height: window.innerHeight }"
          );
          return dims.width < maximized.width && dims.height < maximized.height
            ? dims
            : false;
        },
        { timeout: 5_000, message: "Window did not shrink after restore" }
      );
    }
  );

  // TC-104: aria-label sync
  tc("104", "Maximize/Restore aria-label matches window state", async (driver) => {
    // Start from a non-maximized state (TC-103 restores to non-maximized).
    let label = await driver
      .findElement({ css: NAV.maximizeRestore })
      .then((el) => el.getAttribute("aria-label"));
    assert.strictEqual(label, "Maximize", "aria-label should be 'Maximize' when not maximized");

    // Maximize.
    await driver.findElement({ css: NAV.maximizeRestore }).then((el) => el.click());
    await waitUntil(
      async () => {
        const lbl = await driver
          .findElement({ css: NAV.maximizeRestore })
          .then((el) => el.getAttribute("aria-label"));
        return lbl === "Restore" ? lbl : false;
      },
      { timeout: 5_000, message: "aria-label did not become 'Restore' after maximize" }
    );

    // Restore.
    await driver.findElement({ css: NAV.maximizeRestore }).then((el) => el.click());
    await waitUntil(
      async () => {
        const lbl = await driver
          .findElement({ css: NAV.maximizeRestore })
          .then((el) => el.getAttribute("aria-label"));
        return lbl === "Maximize" ? lbl : false;
      },
      { timeout: 5_000, message: "aria-label did not become 'Maximize' after restore" }
    );
  });

  // TC-107: Title bar display
  tc("107", "Title bar displays logo and has ~28px height", async (driver) => {
    // Logo image exists.
    const logo = await waitForElement(driver, NAV.logo, { visible: true });
    assert.ok(await logo.isDisplayed(), "Logo img should be displayed");

    // Toolbar / titlebar height ≈ 28px.
    const height: number = await driver.executeScript(
      `const bar = document.querySelector('.xsterm-titlebar');` +
        `return bar ? bar.getBoundingClientRect().height : 0;`
    );
    assert.ok(
      Math.abs(height - 28) <= 2,
      `Title bar height should be ~28px, got ${height}px`
    );
  });

  // TC-106: Title bar drag — skip
  it({
    skip: "WebDriver cannot simulate native OS window dragging. " +
      "Drag-to-move is an OS-level gesture requiring platform-specific UI " +
      "automation (e.g. Win32 MoveWindow via pywinauto); it is out-of-scope " +
      "for browser-based WebDriver testing.",
  }, "TC-106: Title bar drag");

  // TC-105: Close button — MUST be last
  tc(
    "105",
    "Close button — app exits and WebDriver session becomes invalid",
    async (driver) => {
      const btn = await waitForElement(driver, NAV.close, { visible: true });
      await btn.click();

      // Poll until the session is dead (NoSuchSessionError is thrown).
      await waitUntil(
        async () => {
          try {
            await driver.getTitle();
            return false; // still alive, keep polling
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              /no such session|session (not|is) (found|valid)|invalid session/i.test(
                msg
              ) ||
              /no such window|window.*already closed/i.test(msg)
            ) {
              return true; // session is dead — success
            }
            throw err; // unexpected error — propagate
          }
        },
        {
          timeout: 10_000,
          message:
            "App did not exit within 10s after clicking Close. " +
            "Expected NoSuchSessionError.",
        }
      );
    }
  );
});
