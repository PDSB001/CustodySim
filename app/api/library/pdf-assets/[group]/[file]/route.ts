import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { failure } from "@/lib/api-response"

export async function GET(
  _: Request,
  context: { params: Promise<{ group: string; file: string }> },
) {
  const { group, file } = await context.params
  if (
    !["cmaps", "standard_fonts", "wasm"].includes(group) ||
    !/^[A-Za-z0-9_-]+\.(bcmap|pfb|ttf|wasm)$/.test(file)
  )
    return failure("NOT_FOUND", "资源不存在", 404)
  try {
    const bytes = await readFile(
      join(process.cwd(), "node_modules/pdfjs-dist", group, file),
    )
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch {
    return failure("NOT_FOUND", "资源不存在", 404)
  }
}
