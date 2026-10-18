import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

// Exercise actual plugin rules, including violations absent from the clean tree.
// A successful repository lint alone cannot show that an adapter kept them active.
const eslint = new ESLint({
  overrideConfig: [{ rules: { "import/no-duplicates": "error" } }],
})

describe("ESLint 10 plugin compatibility", () => {
  it.each([
    {
      rule: "react/jsx-key",
      code: "export default function Probe() { return [1].map(value => <span>{value}</span>) }",
    },
    {
      rule: "jsx-a11y/alt-text",
      code: 'export default function Probe() { return <img src="/cover.png" /> }',
    },
    {
      rule: "import/no-duplicates",
      code: 'import { useState } from "react"; import { useMemo } from "react"; export { useState, useMemo }',
    },
    {
      rule: "@typescript-eslint/no-explicit-any",
      code: "export const identity = (value: any) => value",
    },
  ])("still reports $rule", async ({ rule, code }) => {
    const [result] = await eslint.lintText(code, {
      filePath: "components/lint-upgrade-probe.tsx",
    })
    expect(result.fatalErrorCount).toBe(0)
    expect(result.messages.map((message) => message.ruleId)).toContain(rule)
  })
})
