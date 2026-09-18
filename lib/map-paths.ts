/**
 * 使用腾讯地图 GL 的页面路径前缀。
 *
 * 地图脚本与 `unsafe-eval` 由 CSP 按路径放行 —— 新增地图页面时**必须**在这里登记，
 * 否则页面本身能打开，但地图脚本会被 CSP 静默拦掉，表现为一片空白。
 */
const TENCENT_MAP_PATH_PREFIXES = [
  "/electronic-fences",
  "/my/electronic-fence",
  "/location-tracks",
  "/supervisor/location-tracks",
]

export function isTencentMapPath(pathname: string) {
  return TENCENT_MAP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
