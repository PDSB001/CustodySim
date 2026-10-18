// Preserve Next's native flat configs; adapt older plugin rule APIs for ESLint 10.
import { fixupConfigRules } from "@eslint/compat"
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

const config = [
  {
    // Generated bundles and reports contain third-party code. Lint the sources that
    // produce them, including every repository script and configuration file.
    ignores: [
      ".next*/**",
      ".app-workspace/**",
      "artifacts/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".pw-tmp-results/**",
      "out/**",
      "build/**",
    ],
  },
  ...fixupConfigRules([...nextCoreWebVitals, ...nextTypeScript]),
  {
    rules: {
      // Existing controlled-form synchronization relies on these patterns.
      // Keep the stricter React 19 rules available for future opt-in instead
      // of making the current application fail lint without a behavior change.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
]

export default config
