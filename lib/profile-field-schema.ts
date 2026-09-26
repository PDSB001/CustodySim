import { z } from "zod"

export const ProfileFieldSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "SELECT",
    "DATE",
    "COPYWRITE",
    "IMAGE",
  ]),
  required: z.boolean(),
  options: z.array(z.string()),
})
