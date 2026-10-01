import { addCommunityComment } from "@/lib/community-server"
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return addCommunityComment(request, (await context.params).id)
}
