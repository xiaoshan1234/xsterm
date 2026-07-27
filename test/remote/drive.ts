/**
 * Interactive remote-driving REPL for xsterm.
 *
 * Launches the app via tauri-driver (Windows side) and keeps ONE WebDriver
 * session alive while reading commands from stdin, one per line.
 * Designed to run inside tmux so an AI assistant (or a human) can drive the
 * Windows app iteratively: screenshot -> inspect -> modify code -> refresh.
 *
 * Run:  npm run test:remote:drive
 *
 * Commands (one per line):
 *   shot <file.png>        Take a screenshot, saved to the given path
 *   html [css]             Print outerHTML of <css> (default: body), truncated
 *   text <css>             Print visible text of the first matching element
 *   find <css>             Count matches and preview each (tag, class, text)
 *   click <css>            Click the first matching element
 *   sendkeys <css> <text>  Type text into the first matching element
 *   key <KEY>              Send a special key (ENTER, TAB, ESCAPE, ...) to the active element
 *   exec <js>              Execute JS in the page, print JSON result
 *   refresh                Reload the page (picks up new Vite dev-server code)
 *   sleep <ms>             Wait
 *   url                    Print current URL + title
 *   help                   Show this list
 *   quit                   Close the app and exit
 */
import { By, Key, WebDriver } from "selenium-webdriver";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as readline from "node:readline";
import { createDriver } from "./driver.ts";

const HTML_PREVIEW = 4000;

async function main(): Promise<void> {
  console.log("[drive] creating WebDriver session (tauri-driver launches the app)...");
  const driver: WebDriver = await createDriver();
  console.log("[drive] session ready. Type 'help' for commands.");

  const rl = readline.createInterface({ input: process.stdin });

  const shutdown = async (code: number): Promise<never> => {
    await driver.quit().catch(() => {});
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(130));

  const print = (msg: unknown): void => {
    console.log(typeof msg === "string" ? msg : JSON.stringify(msg, null, 2));
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const argString = trimmed.slice(cmd.length).trim();

    try {
      switch (cmd) {
        case "shot": {
          const file = rest[0];
          if (!file) throw new Error("usage: shot <file.png>");
          await mkdir(dirname(file), { recursive: true });
          const png = await driver.takeScreenshot();
          await writeFile(file, Buffer.from(png, "base64"));
          print(`[ok] screenshot saved: ${file}`);
          break;
        }
        case "html": {
          const selector = rest[0] ?? "body";
          const el = await driver.findElement(By.css(selector));
          const html: string = await driver.executeScript(
            "return arguments[0].outerHTML;",
            el
          );
          print(
            html.length > HTML_PREVIEW
              ? html.slice(0, HTML_PREVIEW) + `\n... [truncated, ${html.length} chars total]`
              : html
          );
          break;
        }
        case "text": {
          const el = await driver.findElement(By.css(argString));
          print(await el.getText());
          break;
        }
        case "find": {
          const els = await driver.findElements(By.css(argString));
          print(`[ok] ${els.length} match(es) for "${argString}"`);
          for (const [i, el] of els.slice(0, 10).entries()) {
            const tag = await el.getTagName();
            const cls = await el.getAttribute("class");
            const text = (await el.getText()).slice(0, 80).replace(/\n/g, "\\n");
            print(`  [${i}] <${tag} class="${cls}"> ${text}`);
          }
          if (els.length > 10) print(`  ... and ${els.length - 10} more`);
          break;
        }
        case "click": {
          const el = await driver.findElement(By.css(argString));
          await el.click();
          print("[ok] clicked");
          break;
        }
        case "sendkeys": {
          const selector = rest[0];
          if (!selector) throw new Error("usage: sendkeys <css> <text>");
          const text = argString.slice(selector.length).trim();
          const el = await driver.findElement(By.css(selector));
          await el.sendKeys(text);
          print("[ok] keys sent");
          break;
        }
        case "key": {
          const name = (rest[0] ?? "").toUpperCase() as keyof typeof Key;
          if (!(name in Key)) throw new Error(`unknown key "${rest[0]}" (e.g. ENTER, TAB, ESCAPE, ARROW_DOWN)`);
          await driver.actions().sendKeys(Key[name]).perform();
          print("[ok] key sent");
          break;
        }
        case "exec": {
          const result = await driver.executeScript(`return (${argString});`);
          print(result);
          break;
        }
        case "refresh": {
          await driver.navigate().refresh();
          print("[ok] page refreshed");
          break;
        }
        case "sleep": {
          await new Promise((r) => setTimeout(r, Number(rest[0] ?? 1000)));
          print("[ok] done");
          break;
        }
        case "url": {
          print({ url: await driver.getCurrentUrl(), title: await driver.getTitle() });
          break;
        }
        case "help": {
          print(
            [
              "shot <file.png> | html [css] | text <css> | find <css>",
              "click <css> | sendkeys <css> <text> | key <KEY> | exec <js>",
              "refresh | sleep <ms> | url | quit",
            ].join("\n")
          );
          break;
        }
        case "quit":
        case "exit": {
          await shutdown(0);
          break;
        }
        default:
          print(`[error] unknown command "${cmd}" - type 'help'`);
      }
    } catch (err) {
      print(`[error] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await shutdown(0);
}

main().catch((err) => {
  console.error("[drive] fatal:", err instanceof Error ? err.message : err);
  console.error(
    "[drive] is the Windows WebDriver stack running? " +
      "See scripts/windows/start-webdriver.ps1"
  );
  process.exit(1);
});
