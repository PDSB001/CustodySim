import { deleteCommunityComment } from "@/lib/community-server"
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return deleteCommunityComment((await context.params).id)
}
