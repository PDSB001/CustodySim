import type { NextResponse } from "next/server"

import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_SECONDS,
  MFA_CHALLENGE_COOKIE_NAME,
  MFA_CHALLENGE_TTL_SECONDS,
  MFA_TRUSTED_DEVICE_COOKIE_NAME,
  MFA_TRUSTED_DEVICE_TTL_SECONDS,
} from "@/lib/constants"

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

export function setMfaChallengeCookie(response: NextResponse, token: string) {
  response.cookies.set(MFA_CHALLENGE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: MFA_CHALLENGE_TTL_SECONDS,
  })
}

export function clearMfaChallengeCookie(response: NextResponse) {
  response.cookies.set(MFA_CHALLENGE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  })
}

export function setMfaTrustedDeviceCookie(
  response: NextResponse,
  value: string,
) {
  response.cookies.set(MFA_TRUSTED_DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: MFA_TRUSTED_DEVICE_TTL_SECONDS,
  })
}

export function clearMfaTrustedDeviceCookie(response: NextResponse) {
  response.cookies.set(MFA_TRUSTED_DEVICE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  })
}
