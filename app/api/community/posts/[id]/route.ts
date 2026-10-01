import { communityDetail, deleteCommunityPost } from "@/lib/community-server"
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  return communityDetail(request, (await context.params).id)
}
export async function DELETE(_request: Request, context: Context) {
  return deleteCommunityPost((await context.params).id)
}
