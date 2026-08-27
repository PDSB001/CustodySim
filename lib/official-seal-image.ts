import {
  defaultOfficialSealText,
  type OfficialSealKind,
} from "@/lib/official-seal"

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

function toDataUrl(svg: string) {
  if (typeof Buffer !== "undefined")
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

function buildOrganizationRingText(value: string) {
  const characters = Array.from(value.trim() || "第一监狱").slice(0, 14)
  const span =
    characters.length <= 1
      ? 0
      : Math.min(194, Math.max(108, (characters.length - 1) * 28))
  const start = -90 - span / 2
  const radius = 121
  return characters
    .map((character, index) => {
      const angle =
        characters.length <= 1
          ? -90
          : start + (span * index) / (characters.length - 1)
      const radians = (angle * Math.PI) / 180
      const x = 180 + radius * Math.cos(radians)
      const y = 180 + radius * Math.sin(radians)
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" transform="rotate(${(angle + 90).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle">${escapeXml(character)}</text>`
    })
    .join("")
}

function buildSealText(value: string) {
  const characters = Array.from(value.trim()).slice(0, 12)
  const text = characters.join("") || "档案归档章"
  const fontSize = characters.length > 8 ? 18 : characters.length > 6 ? 21 : 25
  const textLength = Math.min(210, Math.max(132, characters.length * 31))
  return {
    fontSize,
    text: escapeXml(text),
    textLength,
  }
}

export function generateOfficialSealData({
  kind = "PROFILE",
  organizationName = "第一监狱",
  sealText = defaultOfficialSealText(kind),
}: {
  kind?: OfficialSealKind
  organizationName?: string
  sealText?: string
} = {}) {
  const sealTextLayout = buildSealText(
    sealText.trim() || defaultOfficialSealText(kind),
  )
  const organizationRingText = buildOrganizationRingText(organizationName)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><title>业务电子印章</title><g fill="#c81e1e" stroke="#c81e1e" font-family="STSong, SimSun, serif"><circle cx="180" cy="180" r="142" fill="none" stroke-width="6"/><g stroke="none" font-size="26" font-weight="700" letter-spacing=".6">${organizationRingText}</g><path d="M180 142l9.2 27.8h29.3l-23.7 17.5 9.1 28.2-23.9-17.5-23.9 17.5 9.1-28.2-23.7-17.5h29.3z" stroke="none"/><text x="180" y="252" text-anchor="middle" stroke="none" font-size="${sealTextLayout.fontSize}" font-weight="700" letter-spacing="1.6" textLength="${sealTextLayout.textLength}" lengthAdjust="spacingAndGlyphs">${sealTextLayout.text}</text></g></svg>`
  return toDataUrl(svg)
}
