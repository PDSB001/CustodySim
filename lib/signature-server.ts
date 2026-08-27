import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

export { generateOfficialSealData } from "@/lib/official-seal-image"

function getEncryptionKey() {
  const secret =
    process.env.ARCHIVE_SIGNATURE_ENCRYPTION_KEY ?? process.env.AUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error("签名加密密钥必须至少包含 32 个字符")
  return createHash("sha256").update(secret).digest()
}

export function encryptHandwrittenSignature(data: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    "v1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url"),
  ].join(".")
}

export function decryptHandwrittenSignature(payload: string) {
  const [version, iv, encrypted, tag] = payload.split(".")
  if (!iv || !encrypted || !tag || version !== "v1")
    throw new Error("手写签名加密数据无效")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

function escapeXml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  )
}

export function generateFormattedSignatureData(name: string) {
  const safeName = escapeXml(name.trim() || "本人签名")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect width="640" height="200" fill="#fff"/><path d="M36 160H604" stroke="#cbd5e1" stroke-width="2"/><text x="320" y="132" text-anchor="middle" fill="#172554" font-size="84" font-family="STXingkai, KaiTi, 'Segoe Print', cursive">${safeName}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}
