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

  // Domain models are pure and must stay independent from every upper layer.
  {
    files: ["src/models/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "@tauri-apps/**",
                "**/app/**",
                "**/features/**",
                "**/infra/**",
                "**/shared/**",
              ],
              message:
                "Domain models must not depend on React, Tauri, app, features, infra, or shared.",
            },
          ],
        },
      ],
    },
  },

  // Shared primitives must not depend on application or domain-specific layers.
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/**", "**/features/**", "**/models/**", "**/infra/**"],
              message: "Shared code must not depend on app, features, models, or infra.",
            },
          ],
        },
      ],
    },
  },

  // Raw Tauri commands and events may only be imported by infrastructure adapters.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
    ignores: ["src/**/infrastructure/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              message:
                "Use a feature-local infrastructure adapter instead of importing Tauri core.",
            },
            {
              name: "@tauri-apps/api/event",
              message:
                "Use a feature-local infrastructure adapter instead of importing Tauri events.",
            },
          ],
        },
      ],
    },
  },

  // The app layer consumes feature public entries, never feature implementation paths.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features/*/application",
                "**/features/*/application/**",
                "**/features/*/infrastructure",
                "**/features/*/infrastructure/**",
                "**/features/*/persistence",
                "**/features/*/persistence/**",
                "**/features/*/selectors",
                "**/features/*/selectors/**",
                "**/features/*/state",
                "**/features/*/state/**",
                "**/features/*/ui",
                "**/features/*/ui/**",
                "**/features/*/viewModels",
                "**/features/*/viewModels/**",
              ],
              message: "Import feature capabilities through the feature root index.ts.",
            },
          ],
        },
      ],
    },
  },

  // Features may call another feature's public entry, not its internal layers.
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../*/application",
                "../*/application/**",
                "../*/infrastructure",
                "../*/infrastructure/**",
                "../*/persistence",
                "../*/persistence/**",
                "../*/selectors",
                "../*/selectors/**",
                "../*/state",
                "../*/state/**",
                "../*/ui",
                "../*/ui/**",
                "../*/viewModels",
                "../*/viewModels/**",
                "../../*/application",
                "../../*/application/**",
                "../../*/infrastructure",
                "../../*/infrastructure/**",
                "../../*/persistence",
                "../../*/persistence/**",
                "../../*/selectors",
                "../../*/selectors/**",
                "../../*/state",
                "../../*/state/**",
                "../../*/ui",
                "../../*/ui/**",
                "../../*/viewModels",
                "../../*/viewModels/**",
                "../../../*/application",
                "../../../*/application/**",
                "../../../*/infrastructure",
                "../../../*/infrastructure/**",
                "../../../*/persistence",
                "../../../*/persistence/**",
                "../../../*/selectors",
                "../../../*/selectors/**",
                "../../../*/state",
                "../../../*/state/**",
                "../../../*/ui",
                "../../../*/ui/**",
                "../../../*/viewModels",
                "../../../*/viewModels/**",
              ],
              message: "Import another feature through its root index.ts.",
            },
          ],
        },
      ],
    },
  },

  // Feature UI consumes application contracts, never adapters or Tauri plugins.
  {
    files: ["src/features/**/ui/**/*.{ts,tsx}", "src/features/**/view/**/*.{ts,tsx}"],
    ignores: ["src/features/**/infrastructure/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              message: "Use a feature application contract instead of Tauri core.",
            },
            {
              name: "@tauri-apps/api/event",
              message: "Use a feature-local event bridge instead of Tauri events.",
            },
          ],
          patterns: [
            {
              group: ["**/infrastructure/**", "@tauri-apps/plugin-*"],
              message:
                "Feature UI must call an application action, not an infrastructure adapter or Tauri plugin.",
            },
          ],
        },
      ],
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
