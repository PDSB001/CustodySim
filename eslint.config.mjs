// Next 16 exposes native flat configs. Using FlatCompat here converts those
// configs back to the legacy shape and makes ESLint 9 encounter circular
// plugin references while formatting errors.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
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
