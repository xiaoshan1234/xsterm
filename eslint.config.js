// Flat config — ESLint v9+ style.
// Stacks three rulesets: JS recommended, TypeScript recommended, React Hooks recommended.
// Project-specific tweaks: relax the few rules that would generate noise without
// catching real issues on this codebase.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Global ignores — generated and dependency directories.
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "test/**",
      "*.config.ts",
      "*.config.js",
      "scripts/**",
    ],
  },

  // Base JS recommended.
  js.configs.recommended,

  // TypeScript recommended — type-checked rules need a tsconfig to find.
  ...tseslint.configs.recommended,

  // React Hooks recommended — Rules of Hooks + exhaustive-deps.
  {
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },

  // Project-specific tweaks.
  {
    rules: {
      // Catch unused imports/vars, but allow underscore-prefixed to silence "unused".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` is rarely the right answer — warn so it shows up in review.
      "@typescript-eslint/no-explicit-any": "warn",
      // Force `import type` for type-only imports so the bundler can elide them.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Allow non-null assertions (we use them deliberately after length/lookup checks).
      "@typescript-eslint/no-non-null-assertion": "off",
      // Empty interfaces are sometimes intentional (extendable marker types).
      "@typescript-eslint/no-empty-object-type": "off",
      "no-new": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // react-hooks v5 flags three React idioms that this codebase uses heavily:
      // the "latest-value ref" pattern, setState inside useEffect to reset dialog
      // state when props change, and direct ref mutation inside event handlers.
      // These are not bugs — the alternative is a sweeping refactor with no
      // behavior change. If re-enabling, audit dialog components first.
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },

  // Test files get a more relaxed set (they often use any / globals).
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);