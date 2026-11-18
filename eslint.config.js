import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "plugins/*/connector.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
  },
  {
    files: ["plugins/**/client.js"],
    languageOptions: {
      sourceType: "script",
      globals: { setTimeout: "readonly", setInterval: "readonly", Intl: "readonly" },
    },
  },
);
