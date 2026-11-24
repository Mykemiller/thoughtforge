import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lib/faraday-gate/ (FDY-414) and lib/faraday-masthead/ (FDY-444/447) are vendored byte-identical from
  // faraday-workbench; they are linted there, not here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "lib/faraday-gate/**", "lib/faraday-masthead/**"]),
]);

export default eslintConfig;
