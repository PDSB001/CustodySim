import type { NextResponse } from "next/server"

import { AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_SECONDS } from "@/lib/constants"

function shouldUseSecureCookie() {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true
  if (process.env.AUTH_COOKIE_SECURE === "false") return false
  return process.env.NODE_ENV === "production"
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: AUTH_TOKEN_TTL_SECONDS,
  })
}

export function clearAuthCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    maxAge: 0,
  })
}
