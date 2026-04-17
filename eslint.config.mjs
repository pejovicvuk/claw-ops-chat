import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled JS artifacts and CJS wrappers
    "server.js",
    "src/lib/auth-server.js",
    "src/lib/claude-status.js",
    "sdk-loader.js",
  ]),
  // server.ts uses require() for the SDK to work around tsx/esbuild import.meta.url issues.
  {
    files: ["server.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Disable ESLint rules that conflict with Prettier (must be last).
  prettierConfig,
]);

export default eslintConfig;
