#!/usr/bin/env node
/**
 * run.ts — xsterm UI-test orchestrator
 *
 * Workflow:
 *   1. Run preflight (must pass before any spec is executed)
 *   2. If specs/ is non-empty → run them serially via Node test runner
 *   3. Aggregate exit codes and exit 0/1
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const PREFLIGHT_SCRIPT = path.join(import.meta.dirname, "preflight.ts");
const SPECS_DIR = path.join(import.meta.dirname, "specs");

// Parse CLI args: `--spec <name>` runs only the named spec (e.g. "window").
const ARGS = process.argv.slice(2);
function specFilter(): string | null {
  const i = ARGS.indexOf("--spec");
  if (i !== -1 && ARGS[i + 1]) return ARGS[i + 1];
  return null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function runNode(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "node",
      ["--experimental-strip-types", script, ...args],
      { stdio: "inherit", shell: false },
    );
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`spawn error: ${err.message}`);
      resolve(1);
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    "\n" +
      "═".repeat(60) + "\n" +
      "  xsterm UI-test orchestrator\n" +
      "═".repeat(60) + "\n",
  );

  // Step 1: preflight
  console.log("▶  Running preflight checks …\n");
  const preflightCode = await runNode(PREFLIGHT_SCRIPT, []);
  if (preflightCode !== 0) {
    console.error(
      "\n❌  Preflight failed — aborting spec execution.\n" +
        "    Fix the issues and re-run:\n" +
        "      npm run test:ui:preflight\n",
    );
    process.exit(1);
  }

  // Step 2: discover specs
  let specFiles: string[] = [];
  try {
    const entries = await fs.promises.readdir(SPECS_DIR);
    specFiles = entries
      .filter((f) => f.endsWith(".spec.ts") || f.endsWith(".spec.mts"))
      .map((f) => path.join(SPECS_DIR, f))
      .sort();
  } catch {
    // specs dir does not exist yet — not an error
  }

  // Apply --spec <name> filter (matches spec filename substring).
  const filter = specFilter();
  if (filter) {
    specFiles = specFiles.filter((f) => f.includes(filter));
    if (specFiles.length === 0) {
      console.error(`\n❌  No spec matches --spec "${filter}".`);
      process.exit(1);
    }
  }

  if (specFiles.length === 0) {
    console.log(
      "\nℹ️  No spec files found in test/sys-test/specs/.\n" +
        "    This is expected until Wave 2 spec files are added.\n" +
        "    Create .spec.ts files alongside this message to execute them.\n",
    );
    process.exit(0);
  }

  // Step 3: run specs serially
  console.log(
    `\n▶  Running ${specFiles.length} spec(s) serially …\n`,
  );
  let overall = 0;
  const startedAt = Date.now();
  for (const spec of specFiles) {
    const rel = path.relative(process.cwd(), spec);
    console.log(`\n${"─".repeat(60)}\n▶  ${rel}\n${"─".repeat(60)}`);
    const code = await runNode("--test", [`--test-concurrency=1`, spec]);
    if (code !== 0) overall = 1;
    console.log(`${rel} → exit ${code}`);
  }

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const budgetMsg =
    Number(elapsedMin) > 30
      ? `\n⚠️  Suite took ${elapsedMin} min — exceeds 30-min budget.`
      : "";

  console.log(
    "\n" +
      "═".repeat(60) +
      "\n" +
      (overall === 0
        ? `✅  All specs passed (${elapsedMin} min).`
        : `❌  One or more specs failed (${elapsedMin} min).`) +
      budgetMsg +
      "\n" +
      "═".repeat(60) +
      "\n",
  );
  process.exit(overall);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
