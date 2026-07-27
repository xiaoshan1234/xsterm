import { defineConfig } from "vitest/config";

// Pure-logic modules only need a Node environment (no DOM).
// Tests live next to source files (*.test.ts) so vitest picks them up
// with the default include pattern.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});