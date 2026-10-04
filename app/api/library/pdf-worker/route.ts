import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function GET() {
  const source = await readFile(
    join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  )
  return new Response(new Uint8Array(source), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
