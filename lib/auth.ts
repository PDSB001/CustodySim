import bcrypt from "bcryptjs"
import { SignJWT, jwtVerify } from "jose"

import {
  AUTH_TOKEN_TTL_SECONDS,
  MFA_CHALLENGE_TTL_SECONDS,
  type Role,
} from "@/lib/constants"
import { assertUsableSecret } from "@/lib/secret-guard"

const encoder = new TextEncoder()
export type AuthTokenPayload = {
  userId: string
  tokenVersion: number
  role: Role
}

export type MfaChallengePayload = {
  userId: string
  tokenVersion: number
  challengeId: string
}

function getAuthSecret() {
  return encoder.encode(
    assertUsableSecret("AUTH_SECRET", process.env.AUTH_SECRET),
  )
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}
export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

let dummyPasswordHash: Promise<string> | undefined

/**
 * 用户名不存在或不可用时使用的等价 bcrypt 哈希（惰性生成并缓存）。
 * 登录失败路径同样执行一次 bcrypt 比较，消除账号枚举的时序侧信道。
 */
export function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword("custodysim-login-timing-equalizer")
  return dummyPasswordHash
}

export async function signToken(payload: AuthTokenPayload) {
  return new SignJWT({ tokenVersion: payload.tokenVersion, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_TOKEN_TTL_SECONDS}s`)
    .sign(getAuthSecret())
}

export async function verifyToken(
  token: string,
): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
    })
    const { tokenVersion, role } = payload
    if (
      typeof payload.sub !== "string" ||
      typeof tokenVersion !== "number" ||
      typeof role !== "string" ||
      !["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(role)
    )
      return null
    return { userId: payload.sub, tokenVersion, role: role as Role }
  } catch {
    return null
  }
}

export async function signMfaChallenge(
  userId: string,
  tokenVersion: number,
  challengeId: string,
) {
  return new SignJWT({ purpose: "mfa-login", tokenVersion })
    .setJti(challengeId)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MFA_CHALLENGE_TTL_SECONDS}s`)
    .sign(getAuthSecret())
}

export async function signChatRealtimeToken(
  userId: string,
  conversationIds: string[],
  tokenVersion: number,
) {
  return new SignJWT({
    purpose: "chat-realtime",
    conversationIds,
    tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getAuthSecret())
}

export async function verifyMfaChallenge(
  token: string,
): Promise<MfaChallengePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
    })
    if (
      payload.purpose !== "mfa-login" ||
      typeof payload.jti !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(payload.jti) ||
      typeof payload.sub !== "string" ||
      typeof payload.tokenVersion !== "number"
    )
      return null
    return {
      userId: payload.sub,
      tokenVersion: payload.tokenVersion,
      challengeId: payload.jti,
    }
  } catch {
    return null
  }
}
