export const AVATAR_MAX_BYTES = 64 * 1024
export const AVATAR_MAX_BODY = 90 * 1024

/** Only small raster JPEG data is accepted; arbitrary URLs and SVG are never stored. */
export function validAvatar(value: unknown): value is string {
  if (typeof value !== "string" || value.length > AVATAR_MAX_BODY) return false
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return false
  const bytes = Buffer.from(match[1], "base64")
  if (
    bytes.length > AVATAR_MAX_BYTES ||
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    return false
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return false
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) return false
    if (offset + 2 > bytes.length) return false
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return false
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      return height > 0 && width > 0 && height <= 512 && width <= 512
    }
    offset += length
  }
  return false
}
