import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The rules suite is Node, not a browser, and it is not React. `useRulesHarness()` is a
    // Vitest lifecycle helper whose name happens to match the hook convention, so the
    // rules-of-hooks check fires on a file that has never seen a component.
    files: ["tests/rules/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
