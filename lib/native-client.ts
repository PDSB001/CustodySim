/**
 * 原生客户端（Android App）识别。
 *
 * 用途一：豁免 `proxy.ts` 的同源校验。生产环境下 `/api/**` 的写请求必须有可信
 * `Origin`，而原生 HTTP 客户端默认不发送该头，会被一律 403。
 *
 * 为什么用"自定义请求头"作为豁免依据是安全的：浏览器发起跨源请求时，只要带了
 * 自定义头就会先触发 CORS 预检，而本服务不会为第三方来源返回放行头，因此**跨源
 * 页面无法伪造出这个头**。它与 CSRF token 属于同一类防护思路。
 *
 * 该头不参与鉴权 —— 请求仍需通过令牌验证，所以伪造它拿不到任何权限。
 */
export const NATIVE_CLIENT_HEADER = "x-custodysim-client"

/** 约定值形如 `android-app/1`，版本号随协议变更递增，便于日后区分客户端代际。 */
const NATIVE_CLIENT_PATTERN = /^android-app\/\d+$/

export function isNativeClient(headers: Headers) {
  const value = headers.get(NATIVE_CLIENT_HEADER)?.trim()
  return Boolean(value && NATIVE_CLIENT_PATTERN.test(value))
}
