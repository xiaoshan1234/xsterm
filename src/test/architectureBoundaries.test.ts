import { describe, expect, it } from "vitest";

const sourceFiles = import.meta.glob("/src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const importPattern = /(?:from\s+|import\s*)["']([^"']+)["']/g;

describe("feature architecture boundaries", () => {
  it("does not import a feature through its own root barrel", () => {
    const violations: string[] = [];

    for (const [path, source] of Object.entries(sourceFiles)) {
      const match = path.match(/^\/src\/features\/([^/]+)\//);
      if (!match) continue;
      const feature = match[1];

      for (const importMatch of source.matchAll(importPattern)) {
        const specifier = importMatch[1];
        if (specifier.endsWith(`/features/${feature}`)) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
