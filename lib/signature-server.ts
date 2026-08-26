import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

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

export function generateOfficialSealData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260"><circle cx="130" cy="130" r="104" fill="none" stroke="#b91c1c" stroke-width="7"/><circle cx="130" cy="130" r="78" fill="none" stroke="#b91c1c" stroke-width="2" stroke-dasharray="3 6"/><path d="M130 57l9 28 30 0-24 18 9 29-24-18-24 18 9-29-24-18 30 0z" fill="#b91c1c"/><text x="130" y="166" text-anchor="middle" fill="#b91c1c" font-size="30" font-weight="700" font-family="serif">管理处</text><text x="130" y="196" text-anchor="middle" fill="#b91c1c" font-size="21" font-family="serif">公章</text><text x="130" y="226" text-anchor="middle" fill="#b91c1c" font-size="11" font-family="sans-serif">CUSTODYSIM</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}
