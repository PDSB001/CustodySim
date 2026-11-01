export async function logoutAndRedirect() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("退出登录未完成，请重试")
  window.location.replace("/login")
}
