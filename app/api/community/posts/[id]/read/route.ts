import { readCommunityComments } from "@/lib/community-server"
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return readCommunityComments(request, (await context.params).id)
}
