import sharp from "sharp"

export const COVER_MAX_BYTES = 3 * 1024 * 1024

/** Decode and re-encode only raster images; discard metadata and bound pixel cost. */
export async function prepareBookCover(bytes: Buffer) {
  if (!bytes.length || bytes.length > COVER_MAX_BYTES)
    throw new Error("封面不能超过 3 MB")
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  if (!png && !jpeg && !webp)
    throw new Error("请上传 PNG、JPEG 或 WebP 封面图片")
  try {
    const coverBytes = await sharp(bytes, {
      limitInputPixels: 20_000_000,
      animated: false,
    })
      .rotate()
      .resize({
        width: 900,
        height: 1350,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { coverBytes, coverMime: "image/jpeg" }
  } catch {
    throw new Error("封面图片无法解码或尺寸过大，请换一张图片")
  }
}
