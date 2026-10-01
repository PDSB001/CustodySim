import { communityImage } from "@/lib/community-server"
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return communityImage((await context.params).id)
}
