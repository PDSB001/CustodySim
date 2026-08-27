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
      : Math.min(180, Math.max(100, (characters.length - 1) * 30))
  const start = -90 - span / 2
  const radius = 126
  return characters
    .map((character, index) => {
      const angle = characters.length <= 1 ? -90 : start + (span * index) / (characters.length - 1)
      const radians = (angle * Math.PI) / 180
      const x = 180 + radius * Math.cos(radians)
      const y = 180 + radius * Math.sin(radians)
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" transform="rotate(${(angle + 90).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle">${escapeXml(character)}</text>`
    })
    .join("")
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
  const safeSealText = escapeXml(sealText.trim() || defaultOfficialSealText(kind))
  const organizationRingText = buildOrganizationRingText(organizationName)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><circle cx="180" cy="180" r="150" fill="none" stroke="#b42318" stroke-width="8"/><g fill="#b42318" font-size="22" font-weight="700" font-family="STSong, SimSun, serif">${organizationRingText}</g><path d="M180 150l8.4 25.2h26.6l-21.7 16.1 8.4 25.9-21.7-16.1-21.7 16.1 8.4-25.9-21.7-16.1h26.6z" fill="#b42318"/><text x="180" y="246" text-anchor="middle" fill="#b42318" font-size="24" font-weight="600" font-family="STSong, SimSun, serif" textLength="176" lengthAdjust="spacingAndGlyphs">${safeSealText}</text></svg>`
  return toDataUrl(svg)
}
