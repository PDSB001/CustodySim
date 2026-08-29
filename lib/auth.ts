import bcrypt from "bcryptjs"
import { SignJWT, jwtVerify } from "jose"

import {
  AUTH_TOKEN_TTL_SECONDS,
  MFA_CHALLENGE_TTL_SECONDS,
  type Role,
} from "@/lib/constants"

const encoder = new TextEncoder()
export type AuthTokenPayload = {
  userId: string
  tokenVersion: number
  role: Role
}

export type MfaChallengePayload = {
  userId: string
  tokenVersion: number
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters")
  return encoder.encode(secret)
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}
export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
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
    const { payload } = await jwtVerify(token, getAuthSecret())
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

export async function signMfaChallenge(userId: string, tokenVersion: number) {
  return new SignJWT({ purpose: "mfa-login", tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MFA_CHALLENGE_TTL_SECONDS}s`)
    .sign(getAuthSecret())
}

export async function signChatRealtimeToken(
  userId: string,
  conversationIds: string[],
) {
  return new SignJWT({ purpose: "chat-realtime", conversationIds })
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
    const { payload } = await jwtVerify(token, getAuthSecret())
    if (
      payload.purpose !== "mfa-login" ||
      typeof payload.sub !== "string" ||
      typeof payload.tokenVersion !== "number"
    )
      return null
    return { userId: payload.sub, tokenVersion: payload.tokenVersion }
  } catch {
    return null
  }
}
