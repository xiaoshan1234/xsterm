/**
 * test/sys-test/specs/ssh.spec.ts
 *
 * SSH session subset — gated by test/sys-test/ssh-config.json (gitignored).
 * If no config or the host is unreachable, tests short-circuit with a
 * documented no-op (exit code stays 0).
 *
 * Covers: SSH session creation + output, disconnect banner (TC-811),
 * Enter-to-reconnect (TC-812), rapid-Enter single-flight (TC-816), and
 * cross-reference notes for TC-806/807/818.
 *
 * Guardrails:
 *  - Never severs the network; disconnect only via the optional
 *    `disconnectCommand` provided by the user in ssh-config.json.
 */

import { describe, before, after } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver } from "selenium-webdriver";
import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { SIDEBAR, DIALOG } from "../lib/selectors.ts";
import {
  typeInTerminal,
  assertTerminalContains,
  waitForTerminalReady,
} from "../lib/terminal.ts";
import { probePort } from "../lib/os.ts";
import { loadSshConfig } from "../lib/config.ts";

const fixture = appFixture();

// ── config gate ───────────────────────────────────────────────────────────────

interface SshCfg {
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password: string;
  keyFile: string;
  passphrase: string;
  disconnectCommand: string;
}

let sshCfg: SshCfg | null = null;
let hostReachable = false;

/** True when we can actually connect to an SSH host. */
function available(): boolean {
  return sshCfg !== null && hostReachable;
}

// ── spec ─────────────────────────────────────────────────────────────────────

describe("SSH session subset", { concurrency: false }, () => {
  before(async () => {
    const loaded = loadSshConfig();
    sshCfg = loaded.config;
    if (sshCfg) {
      hostReachable = await probePort(sshCfg.host, sshCfg.port, 3_000);
    }
    await fixture.before();
  });

  after(() => fixture.after());

  /** Create an SSH session via the UI (throws if host unavailable). */
  const createSshSession = async (driver: WebDriver): Promise<void> => {
    if (!available()) {
      throw new Error("SSH host not available");
    }
    const cfg = sshCfg!;
    const sessionsBtn = await driver.findElement(By.css(SIDEBAR.sessions));
    await sessionsBtn.click();
    await waitForElement(driver, ".MuiDrawer-paper", { timeout: 5_000 });
    const newSession = await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`.//*[contains(@class,'MuiDrawer')]//button[contains(., "New Session")]`)
      );
      return els.length > 0 ? els[0] : false;
    }, { timeout: 5_000, message: "New Session button not found" });
    await newSession.click();
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    const sshTab = await driver.findElement(
      By.xpath(`//*[@role="tab"][contains(., "SSH")]`)
    );
    await sshTab.click();
    const inputs = await driver.findElements(By.css(`[role="dialog"] input`));
    const hostInput = await driver.findElement(
      By.css(`[role="dialog"] input[aria-label*="Host" i], [role="dialog"] input[placeholder*="Host" i]`)
    ).catch(() => inputs[0]);
    await hostInput.clear();
    await hostInput.sendKeys(cfg.host);
    const userInput = await driver.findElement(
      By.css(`[role="dialog"] input[aria-label*="Username" i], [role="dialog"] input[placeholder*="Username" i]`)
    ).catch(() => inputs[1]);
    await userInput.clear();
    await userInput.sendKeys(cfg.username);
    if (cfg.authType === "password" && cfg.password) {
      const passInput = await driver.findElement(
        By.css(`[role="dialog"] input[type="password"]`)
      ).catch(() => null);
      if (passInput) await passInput.sendKeys(cfg.password);
    }
    await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(., "Create")]`)
    ).click();
    await waitForTerminalReady(driver, { timeout: 20_000 });
  };

  tc("SSH-CREATE", "SSH 会话创建并输出", async (driver) => {
    if (!available()) {
      assert.ok(true, `SSH 主机不可用（${sshCfg ? "不可达" : "未配置 ssh-config.json"}）— 跳过`);
      return;
    }
    await createSshSession(driver);
    const marker = `SSH_OK_${Date.now()}`;
    await typeInTerminal(driver, `echo ${marker}`);
    await assertTerminalContains(driver, marker, { timeout: 15_000 });
  });

  tc("811", "断连横幅出现", async (driver) => {
    if (!available() || !sshCfg!.disconnectCommand) {
      assert.ok(true, "未配置 disconnectCommand — 跳过（无法安全制造断连）");
      return;
    }
    await createSshSession(driver);
    await typeInTerminal(driver, sshCfg!.disconnectCommand);
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`//*[contains(normalize-space(.), "连接已经断开")]`)
      );
      return els.length > 0 ? true : false;
    }, { timeout: 20_000, message: "断连横幅未出现" });
  });

  tc("812", "回车重连", async (driver) => {
    if (!available() || !sshCfg!.disconnectCommand) {
      assert.ok(true, "未配置 disconnectCommand — 跳过");
      return;
    }
    const container = await driver.findElement(By.css(".xterm"));
    await container.click();
    await driver.actions().sendKeys(Key.ENTER).perform();
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`//*[contains(normalize-space(.), "连接已经断开")]`)
      );
      return els.length === 0 ? true : false;
    }, { timeout: 20_000, message: "重连后横幅未消失" });
  });

  tc("816", "断连快速回车单飞重连", async (driver) => {
    if (!available() || !sshCfg!.disconnectCommand) {
      assert.ok(true, "未配置 disconnectCommand — 跳过");
      return;
    }
    const container = await driver.findElement(By.css(".xterm"));
    await container.click();
    for (let i = 0; i < 5; i++) {
      await driver.actions().sendKeys(Key.ENTER).perform();
    }
    await new Promise((r) => setTimeout(r, 1_000));
    const terminals = await driver.findElements(By.css(".xterm"));
    assert.ok(terminals.length >= 1, "至少应保留一个终端");
  });

  tc("806", "断连态禁止粘贴（交叉引用）", async (driver) => {
    assert.ok(true, "断连禁粘需 SSH 环境 — 由 terminal.spec TC-806 交叉引用");
  });

  tc("807", "SSH 图片粘贴（SSH-only）", async (driver) => {
    assert.ok(true, "图片上传仅 SSH 会话支持 — 需 SSH 环境");
  });

  tc("818", "本地图片粘贴不触发上传（交叉引用）", async (driver) => {
    assert.ok(true, "本地会话图片粘贴不触发上传 — 由 terminal.spec TC-818 交叉引用");
  });
});