import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Deploy artefacts — staged standalone bundle for the Azure zip-deploy
    // flow documented in docs/deploy/azure.md. Generated, never authored.
    ".deploy/**",
    "deploy-pkg/**",
    "deploy.zip",
  ]),
]);

export default eslintConfig;
