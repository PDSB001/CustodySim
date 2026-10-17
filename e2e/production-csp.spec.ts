import { expect, test } from "@playwright/test"

declare global {
  interface Window {
    __cspTestViolations: string[]
  }
}

test("生产 nonce 信任链允许地图 SDK、eval 和 Worker，普通页面无 CSP 违规", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__cspTestViolations = []
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspTestViolations.push(
        `${event.effectiveDirective}: ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`,
      )
    })
  })
  // Test the real SDK loading path with a controlled response, without keys or external requests.
  await page.route("https://map.qq.com/api/gljs**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      eval("document.documentElement.dataset.cspEvalReady = 'true'");
      class Layer { setGeometries() {} destroy() {} }
      window.TMap = {
        LatLng: class { constructor(lat, lng) { this.lat=lat; this.lng=lng; } },
        Map: class { constructor(el) { el.dataset.cspMapReady='true'; } on() {} destroy() {} },
        MultiPolygon: Layer, PolygonStyle: Layer, MultiPolyline: Layer, PolylineStyle: Layer,
        MultiMarker: Layer, MarkerStyle: Layer, CircleStyle: Layer
      };
      const url = URL.createObjectURL(new Blob(["postMessage('ready')"], {type:'text/javascript'}));
      const worker = new Worker(url);
      worker.onmessage = () => { document.documentElement.dataset.cspWorkerReady='true'; worker.terminate(); URL.revokeObjectURL(url); };
    `,
    }),
  )
  const login = await page.goto("/login")
  expect(login?.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  )
  expect(login?.headers()["content-security-policy"]).not.toContain(
    "'unsafe-eval'",
  )
  await expect(page.getByLabel("账号")).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__cspTestViolations))
    .toEqual([])
  await page.getByLabel("账号").fill("rank_admin")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("heading", { name: "快捷管理" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(await page.evaluate(() => window.__cspTestViolations)).toEqual([])

  const map = await page.goto("/electronic-fences")
  const csp = map?.headers()["content-security-policy"] ?? ""
  expect(csp).toContain("'strict-dynamic'")
  expect(csp).toContain("'unsafe-eval'")
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()
  expect(
    await page
      .locator('script[src*="/_next/"]')
      .evaluateAll(
        (scripts, nonce) =>
          scripts.some(
            (script) => (script as HTMLScriptElement).nonce === nonce,
          ),
        nonce,
      ),
  ).toBe(true)
  await expect(page.locator("[data-csp-map-ready=true]")).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute(
    "data-csp-eval-ready",
    "true",
  )
  await expect(page.locator("html")).toHaveAttribute(
    "data-csp-worker-ready",
    "true",
  )
  expect(await page.evaluate(() => window.__cspTestViolations)).toEqual([])
})
