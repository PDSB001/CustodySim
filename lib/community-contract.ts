import { z } from "zod"

// Every scalar form field is eligible, including identity/custom fields,
// but only explicitly selected values enter a community snapshot.
export const COMMUNITY_PROFILE_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "SELECT",
  "DATE",
  "COPYWRITE",
] as const
export function isCommunityProfileField(field: { name: string; type: string }) {
  return (COMMUNITY_PROFILE_FIELD_TYPES as readonly string[]).includes(
    field.type,
  )
}
export const CommunityProfileValueSchema = z.object({
  name: z.string(),
  value: z.string(),
})
export const CommunityPostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorLabel: z.string(),
  isOwn: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.string(),
  commentCount: z.number(),
  imageUrls: z.array(z.string()),
  profileSnapshot: z.array(CommunityProfileValueSchema).nullable(),
})
export const CommunityCommentSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  authorLabel: z.string(),
  isOwn: z.boolean(),
  isAuthor: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.string(),
})
export const CommunityFeedSchema = z.object({
  posts: z.array(CommunityPostSchema),
  hasMore: z.boolean(),
})
export const CommunityDetailSchema = z.object({
  post: CommunityPostSchema,
  comments: z.array(CommunityCommentSchema),
  hasMore: z.boolean(),
})
export type CommunityPost = z.infer<typeof CommunityPostSchema>
export type CommunityComment = z.infer<typeof CommunityCommentSchema>
