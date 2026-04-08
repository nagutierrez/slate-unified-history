/**
 * Flat ESLint config: TypeScript in src/ + test/, Vitest globals/rules for tests,
 * Prettier last so stylistic rules stay off (format via Prettier CLI).
 */
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import vitest from "eslint-plugin-vitest";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    ...vitest.configs.env,
    ...vitest.configs.recommended,
  },
  eslintConfigPrettier,
);
