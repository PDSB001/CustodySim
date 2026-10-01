import { communityFeed, createCommunityPost } from "@/lib/community-server"
export async function GET(request: Request) {
  return communityFeed(request)
}
export async function POST(request: Request) {
  return createCommunityPost(request)
}
