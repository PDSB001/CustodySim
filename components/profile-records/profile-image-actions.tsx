"use client"

import { BadgeCheck, ImageDown } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

type ProfileField = { name: string; type: string }

type ProfileImageActionsProps = {
  person: {
    name: string
    number?: string | null
    organization?: string | null
    custodyLevel?: string | null
  }
  record: {
    id: string
    formName: string
    code?: string | null
    data: Record<string, unknown>
    fields: ProfileField[]
    photoData?: string | null
    signatureData?: string | null
    officialSealData?: string | null
  }
  compact?: boolean
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    }
    return entities[character] ?? character
  })
}

function safeImage(value: string | null | undefined) {
  return value?.startsWith("data:image/") ? value : null
}

function avatarPlaceholder(x: number, y: number, width: number, height: number) {
  const centerX = x + width / 2
  const headY = y + height * 0.36
  const scale = Math.min(width, height)
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e8efff"/>
    <circle cx="${centerX}" cy="${headY}" r="${scale * 0.17}" fill="#88a2e8"/>
    <path d="M${x + width * 0.19} ${y + height * 0.91}c0-${height * 0.22} ${width * 0.14}-${height * 0.34} ${width * 0.31}-${height * 0.34}h${width * 0.2}c${width * 0.17} 0 ${width * 0.31} ${height * 0.12} ${width * 0.31} ${height * 0.34}v${height * 0.07}z" fill="#627fc8"/>
    <text x="${centerX}" y="${y + height * 0.76}" text-anchor="middle" fill="#4664ad" font-family="'Microsoft YaHei', sans-serif" font-size="${Math.max(16, scale * 0.09)}" font-weight="600">默认头像</text>`
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "未填写"
  if (typeof value === "string")
    return value.startsWith("data:image/") ? "已上传图片" : value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return "已填写"
  }
}

function lines(value: string, maxCharacters: number) {
  const normalized = value.replace(/\s+/g, " ").trim() || "未填写"
  const result: string[] = []
  for (let index = 0; index < normalized.length; index += maxCharacters)
    result.push(normalized.slice(index, index + maxCharacters))
  return result.slice(0, 4)
}

function textBlock({
  x,
  y,
  value,
  maxCharacters,
  fontSize = 28,
  color = "#16233f",
  lineHeight = 40,
  weight = 400,
}: {
  x: number
  y: number
  value: string
  maxCharacters: number
  fontSize?: number
  color?: string
  lineHeight?: number
  weight?: number
}) {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" font-size="${fontSize}" font-weight="${weight}">${lines(
    value,
    maxCharacters,
  )
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`
}

function identitySvg(
  person: ProfileImageActionsProps["person"],
  photoData?: string | null,
) {
  const photo = safeImage(photoData)
  const number = person.number || "待分配"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="756" viewBox="0 0 1200 756">
    <defs>
      <clipPath id="identity-photo-clip"><rect x="88" y="216" width="254" height="326" rx="12"/></clipPath>
    </defs>
    <rect width="1200" height="756" fill="#f7f9ff"/>
    <rect x="24" y="24" width="1152" height="708" rx="28" fill="#ffffff"/>
    <path d="M52 24h1096a28 28 0 0 1 28 28v88H24V52a28 28 0 0 1 28-28z" fill="#2648b5"/>
    <text x="76" y="94" fill="#ffffff" font-family="'Microsoft YaHei', sans-serif" font-size="38" font-weight="700" letter-spacing="3">被监管人员身份牌</text>
    <text x="1124" y="92" fill="#c9d7ff" text-anchor="end" font-family="Arial, sans-serif" font-size="18" letter-spacing="2">CUSTODY SIM</text>
    <rect x="76" y="204" width="278" height="350" rx="18" fill="#edf2ff" stroke="#c8d5ff" stroke-width="2"/>
    ${photo ? `<image href="${photo}" x="88" y="216" width="254" height="326" preserveAspectRatio="xMidYMid slice" clip-path="url(#identity-photo-clip)"/>` : avatarPlaceholder(88, 216, 254, 326)}
    <text x="416" y="256" fill="#607197" font-family="'Microsoft YaHei', sans-serif" font-size="20" letter-spacing="2">姓名</text>
    ${textBlock({ x: 416, y: 314, value: person.name, maxCharacters: 12, fontSize: 54, weight: 700 })}
    <text x="416" y="390" fill="#607197" font-family="'Microsoft YaHei', sans-serif" font-size="20" letter-spacing="2">编号</text>
    ${textBlock({ x: 416, y: 430, value: number, maxCharacters: 24, fontSize: 30, weight: 600 })}
    <text x="416" y="500" fill="#607197" font-family="'Microsoft YaHei', sans-serif" font-size="20" letter-spacing="2">所在监室</text>
    ${textBlock({ x: 416, y: 540, value: person.organization || "未分配", maxCharacters: 24, fontSize: 30, weight: 600 })}
    <rect x="904" y="430" width="196" height="72" rx="36" fill="#e4edff"/>
    <text x="1002" y="476" text-anchor="middle" fill="#2648b5" font-family="'Microsoft YaHei', sans-serif" font-size="26" font-weight="700">${escapeXml(person.custodyLevel || "普管")}</text>
    <text x="76" y="662" fill="#8490aa" font-family="'Microsoft YaHei', sans-serif" font-size="18">本身份牌为系统生成副本，请结合当前监管记录核验。</text>
    <text x="1124" y="662" text-anchor="end" fill="#8490aa" font-family="Arial, sans-serif" font-size="18">${escapeXml(new Date().toLocaleDateString("zh-CN"))}</text>
  </svg>`
}

function archiveSvg(
  person: ProfileImageActionsProps["person"],
  record: ProfileImageActionsProps["record"],
) {
  const fieldRows = record.fields.map((field) => ({
    label: field.name,
    value: displayValue(record.data[field.name]),
  }))
  const contentStart = 520
  const rowHeight = 110
  const height = Math.max(
    1754,
    contentStart + fieldRows.length * rowHeight + 250,
  )
  const photo = safeImage(record.photoData)
  const signature = safeImage(record.signatureData)
  const seal = safeImage(record.officialSealData)
  const rows = fieldRows
    .map((field, index) => {
      const y = contentStart + index * rowHeight
      return `<line x1="92" y1="${y + 82}" x2="1148" y2="${y + 82}" stroke="#dbe0ea"/>
        <text x="112" y="${y + 34}" fill="#69758b" font-family="'Microsoft YaHei', sans-serif" font-size="23" font-weight="600">${escapeXml(field.label)}</text>
        ${textBlock({ x: 350, y: y + 34, value: field.value, maxCharacters: 44, fontSize: 25, lineHeight: 31 })}`
    })
    .join("")
  const footerY = contentStart + fieldRows.length * rowHeight + 96
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${height}" viewBox="0 0 1240 ${height}">
    <defs>
      <clipPath id="archive-photo-clip"><rect x="100" y="282" width="196" height="196" rx="6"/></clipPath>
    </defs>
    <rect width="1240" height="${height}" fill="#f5f6fa"/>
    <rect x="48" y="48" width="1144" height="${height - 96}" fill="#ffffff" stroke="#ccd3e1" stroke-width="2"/>
    <rect x="48" y="48" width="1144" height="174" fill="#213e91"/>
    <text x="620" y="120" text-anchor="middle" fill="#ffffff" font-family="'Microsoft YaHei', sans-serif" font-size="42" font-weight="700" letter-spacing="4">个人档案信息副本</text>
    <text x="620" y="164" text-anchor="middle" fill="#cdd9ff" font-family="'Microsoft YaHei', sans-serif" font-size="20">${escapeXml(record.formName)}</text>
    <rect x="92" y="274" width="212" height="212" rx="8" fill="#edf1f8" stroke="#cdd5e4"/>
    ${photo ? `<image href="${photo}" x="100" y="282" width="196" height="196" preserveAspectRatio="xMidYMid slice" clip-path="url(#archive-photo-clip)"/>` : avatarPlaceholder(100, 282, 196, 196)}
    <text x="350" y="314" fill="#69758b" font-family="'Microsoft YaHei', sans-serif" font-size="22">姓名</text>
    ${textBlock({ x: 350, y: 362, value: person.name, maxCharacters: 16, fontSize: 38, weight: 700 })}
    <text x="350" y="424" fill="#69758b" font-family="'Microsoft YaHei', sans-serif" font-size="22">档案编号</text>
    ${textBlock({ x: 510, y: 424, value: record.code || "未归档", maxCharacters: 28, fontSize: 25, weight: 600 })}
    <text x="350" y="470" fill="#69758b" font-family="'Microsoft YaHei', sans-serif" font-size="22">人员编号</text>
    ${textBlock({ x: 510, y: 470, value: person.number || "待分配", maxCharacters: 28, fontSize: 25, weight: 600 })}
    ${rows}
    <line x1="92" y1="${footerY}" x2="1148" y2="${footerY}" stroke="#cdd5e4" stroke-width="2"/>
    ${signature ? `<image href="${signature}" x="96" y="${footerY + 28}" width="240" height="100" preserveAspectRatio="xMidYMid meet"/>` : ""}
    ${seal ? `<image href="${seal}" x="920" y="${footerY + 8}" width="150" height="150" preserveAspectRatio="xMidYMid meet"/>` : ""}
    <text x="92" y="${height - 76}" fill="#8490a6" font-family="'Microsoft YaHei', sans-serif" font-size="18">系统生成图片副本 · 导出时间 ${escapeXml(new Date().toLocaleString("zh-CN"))}</text>
  </svg>`
}

async function downloadPng(svg: string, fileName: string) {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("图片渲染失败"))
      image.src = svgUrl
    })
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth || 1200
    canvas.height = image.naturalHeight || 756
    const context = canvas.getContext("2d")
    if (!context) throw new Error("当前浏览器不支持图片导出")
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    )
    if (!blob) throw new Error("图片编码失败")
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = downloadUrl
    link.download = fileName
    link.click()
    URL.revokeObjectURL(downloadUrl)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

export function ProfileImageActions({
  person,
  record,
  compact = false,
}: ProfileImageActionsProps) {
  const [downloading, setDownloading] = useState<"identity" | "archive" | null>(
    null,
  )
  const exportImage = async (type: "identity" | "archive") => {
    setDownloading(type)
    try {
      const svg =
        type === "identity"
          ? identitySvg(person, record.photoData)
          : archiveSvg(person, record)
      const label = type === "identity" ? "身份牌" : "档案副本"
      await downloadPng(svg, `${person.name}-${label}.png`)
      toast.success(`${label}图片已生成`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败")
    } finally {
      setDownloading(null)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled={Boolean(downloading)}
        onClick={() => exportImage("identity")}
      >
        <BadgeCheck />
        {downloading === "identity" ? "生成中…" : "生成身份牌"}
      </Button>
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled={Boolean(downloading)}
        onClick={() => exportImage("archive")}
      >
        <ImageDown />
        {downloading === "archive" ? "生成中…" : "导出档案图片"}
      </Button>
    </div>
  )
}
