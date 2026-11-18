import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lib/faraday-gate/ is vendored byte-identical from faraday-workbench (FDY-414); it is linted there, not here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "lib/faraday-gate/**"]),
]);

export default eslintConfig;
