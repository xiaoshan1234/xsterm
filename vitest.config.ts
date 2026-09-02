import { defineConfig } from "vitest/config";

// Most tests are pure-logic and run in Node. The hook tests that touch
// ResizeObserver / window.setTimeout / DOM refs need jsdom. The test files
// themselves opt into the DOM environment via `/** @vitest-environment jsdom */`
// at the top, so we keep the default cheap for all other suites.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});