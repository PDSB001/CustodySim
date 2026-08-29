import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

function getMfaKeyMaterial() {
  const dedicatedSecret = process.env.MFA_ENCRYPTION_KEY
  if (!dedicatedSecret && process.env.NODE_ENV === "production")
    throw new Error(
      "MFA_ENCRYPTION_KEY must contain at least 32 characters in production",
    )
  const secret = dedicatedSecret || process.env.AUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error(
      "AUTH_SECRET or MFA_ENCRYPTION_KEY must contain at least 32 characters",
    )
  return secret
}

function getEncryptionKey() {
  return createHash("sha256")
    .update(`custodysim:mfa:encryption:v1:${getMfaKeyMaterial()}`)
    .digest()
}

function getHashKey() {
  return createHash("sha256")
    .update(`custodysim:mfa:hash:v1:${getMfaKeyMaterial()}`)
    .digest()
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

export function toBase32(value: Buffer) {
  let bits = 0
  let bitCount = 0
  let output = ""
  for (const byte of value) {
    bits = (bits << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31]
      bitCount -= 5
    }
  }
  if (bitCount > 0) output += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31]
  return output
}

export function fromBase32(value: string) {
  const normalized = value.replaceAll(/[\s-]/g, "").toUpperCase()
  if (!normalized || /[^A-Z2-7]/.test(normalized))
    throw new Error("Invalid base32 secret")
  let bits = 0
  let bitCount = 0
  const bytes: number[] = []
  for (const character of normalized) {
    bits = (bits << 5) | BASE32_ALPHABET.indexOf(character)
    bitCount += 5
    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 255)
      bitCount -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret() {
  return toBase32(randomBytes(20))
}

export function encryptMfaSecret(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ])
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptMfaSecret(value: string) {
  const [ivValue, tagValue, ciphertextValue, ...extra] = value.split(".")
  if (!ivValue || !tagValue || !ciphertextValue || extra.length > 0)
    throw new Error("Invalid encrypted MFA secret")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

function getTotpCode(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha1", fromBase32(secret))
    .update(counterBuffer)
    .digest()
  const offset = digest[digest.length - 1] & 15
  const value =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255)
  return (value % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0")
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  const normalized = code.replaceAll(/\s/g, "")
  if (!/^\d{6}$/.test(normalized)) return false
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS)
  return [-1, 0, 1].some((offset) =>
    constantTimeEquals(getTotpCode(secret, counter + offset), normalized),
  )
}

function formatRecoveryCode(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () =>
    formatRecoveryCode(toBase32(randomBytes(8)).slice(0, 12)),
  )
}

export function hashRecoveryCode(code: string) {
  return createHmac("sha256", getHashKey())
    .update(
      `custodysim:mfa:recovery:v1:${code.replaceAll(/[\s-]/g, "").toUpperCase()}`,
    )
    .digest("hex")
}

export function generateTrustedDeviceToken() {
  return randomBytes(32).toString("base64url")
}

export function hashTrustedDeviceToken(token: string) {
  return createHmac("sha256", getHashKey())
    .update(`custodysim:mfa:trusted-device:v1:${token}`)
    .digest("hex")
}

export function parseTrustedDeviceCookie(value: string | undefined) {
  if (!value) return null
  const separator = value.indexOf(".")
  if (separator <= 0 || separator === value.length - 1) return null
  const deviceId = value.slice(0, separator)
  const token = value.slice(separator + 1)
  if (
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(deviceId) ||
    !/^[A-Za-z0-9_-]{32,}$/.test(token)
  )
    return null
  return { deviceId, token }
}
