import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  // Flat config does NOT read .gitignore, so build and test output has to be listed here as
  // well. Playwright's HTML report ships a bundled, minified app inside it — lint it and you
  // get ~650 errors from somebody else's build artefact.
  { ignores: ["dist/", "node_modules/", "playwright-report/", "test-results/", "blob-report/"] },
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
    // Build-time Node scripts: the vite plugins and the icon generator.
    files: ["scripts/**/*.{js,mjs}"],
    ignores: ["scripts/sw.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // scripts/sw.js is the service-worker TEMPLATE — it runs in a worker, not in Node and not
    // in a page, so it needs `self`/`caches`/`clients`/`skipWaiting`. Its two build-time
    // placeholders (__PRECACHE__, __INDEX__, __VERSION__) are substituted by the plugin, so
    // they read as undefined identifiers here.
    files: ["scripts/sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __PRECACHE__: "readonly",
        __INDEX__: "readonly",
        __VERSION__: "readonly",
      },
    },
  },
  {
    // The end-to-end suite and its Playwright config are Node. The specs also run code
    // inside the browser via page.evaluate, so they need both global sets.
    files: ["e2e/**/*.js", "playwright.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
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
