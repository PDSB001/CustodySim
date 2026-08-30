import { getRequestIp } from "@/lib/admin-api"
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"

const SENSITIVE_ACTION_NAMESPACE = "sensitive-action"

export function getSensitiveActionIp(headers: Headers) {
  return getRequestIp(headers)
}

export function getSensitiveActionRetryAfterSeconds(
  userId: string,
  ip?: string | null,
) {
  return getLoginRetryAfterSeconds(
    `user:${userId}`,
    ip,
    new Date(),
    SENSITIVE_ACTION_NAMESPACE,
  )
}

export function recordSensitiveActionFailure(
  userId: string,
  ip?: string | null,
) {
  return recordLoginFailure(
    `user:${userId}`,
    ip,
    new Date(),
    SENSITIVE_ACTION_NAMESPACE,
  )
}

export function clearSensitiveActionFailures(
  userId: string,
  ip?: string | null,
) {
  return clearLoginFailures(`user:${userId}`, ip, SENSITIVE_ACTION_NAMESPACE)
}
