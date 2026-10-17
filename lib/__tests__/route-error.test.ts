import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import RouteError from "@/components/shared/route-error"
import GlobalError from "@/app/global-error"

test.each([RouteError, GlobalError])(
  "error fallbacks use the shared button and hide internal error details",
  (Component) => {
    const html = renderToStaticMarkup(
      createElement(Component, {
        error: Object.assign(new Error("internal-secret-path"), {
          digest: "review-test-digest",
        }),
        retry: () => {},
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain("重新加载")
    expect(html).toContain("review-test-digest")
    expect(html).toContain("<title>")
    expect(html).not.toContain("internal-secret-path")
  },
)
