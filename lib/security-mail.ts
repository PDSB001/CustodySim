import { ses } from "tencentcloud-sdk-nodejs-ses"
import { z } from "zod"

export const SecurityEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => {
    const at = value.lastIndexOf("@")
    return value.slice(0, at) + value.slice(at).toLowerCase()
  })
export function maskSecurityEmail(email: string) {
  const at = email.lastIndexOf("@")
  return `${email.slice(0, 1)}***${email.slice(at)}`
}
export function getSecurityMailConfig() {
  const value = {
    secretId: process.env.TENCENT_SES_SECRET_ID?.trim() ?? "",
    secretKey: process.env.TENCENT_SES_SECRET_KEY ?? "",
    region: process.env.TENCENT_SES_REGION?.trim() ?? "",
    from: process.env.TENCENT_SES_FROM?.trim() ?? "",
    codeTemplate: Number(process.env.TENCENT_SES_CODE_TEMPLATE_ID),
    noticeTemplate: Number(process.env.TENCENT_SES_NOTICE_TEMPLATE_ID),
  }
  const configured = Boolean(
    value.secretId &&
    value.secretKey &&
    value.region &&
    SecurityEmailSchema.safeParse(value.from).success &&
    Number.isSafeInteger(value.codeTemplate) &&
    value.codeTemplate > 0 &&
    Number.isSafeInteger(value.noticeTemplate) &&
    value.noticeTemplate > 0,
  )
  return { ...value, configured }
}

export type SecurityMail = {
  to: string
  kind: "code" | "notice"
  params: Record<string, string>
}
export async function sendSecurityMail(mail: SecurityMail) {
  const config = getSecurityMailConfig()
  if (!config.configured) throw new Error("邮件服务尚未配置")
  const client = new ses.v20201002.Client({
    credential: { secretId: config.secretId, secretKey: config.secretKey },
    region: config.region,
    profile: {
      httpProfile: { endpoint: "ses.tencentcloudapi.com", reqTimeout: 10 },
    },
  })
  try {
    const result = await client.SendEmail({
      FromEmailAddress: config.from,
      Destination: [SecurityEmailSchema.parse(mail.to)],
      Subject:
        mail.kind === "code"
          ? "CustodySim 邮箱绑定验证码"
          : "CustodySim 账号安全通知",
      Template: {
        TemplateID:
          mail.kind === "code" ? config.codeTemplate : config.noticeTemplate,
        TemplateData: JSON.stringify(mail.params),
      },
    })
    if (!result.MessageId) throw new Error("MissingMessageId")
  } catch {
    // Provider errors may include recipients or request data; never pass them to logs or clients.
    throw new Error("邮件发送失败，请稍后重试")
  }
}
