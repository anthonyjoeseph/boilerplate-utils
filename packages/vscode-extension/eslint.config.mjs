// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default defineConfig(
  {
    // Spec fixtures are inputs to the tool, not code that has to satisfy the
    // project's style rules. Several deliberately use constructs the rules
    // forbid, because expanding them is exactly what is under test.
    ignores: ["tests/spec/cases/**"]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["off"]
    }
  }
);
