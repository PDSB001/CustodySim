import { z } from "zod"

/**
 * Shared response contract for /api/my/custody-profile.
 *
 * Every consumer of the ["custody-profile"] query cache must parse the same
 * shape. Zod strips unknown object fields by default, so using a narrower
 * schema on one page would otherwise leave incomplete data in the shared
 * React Query cache for the next page.
 */
export const CustodyProfileSchema = z.object({
  custodyLevel: z.string(),
  custodyStatus: z.enum([
    "IN_CUSTODY",
    "ISOLATION",
    "ON_LEAVE",
    "TEMPORARY_OUT_OF_CUSTODY",
    "OUT_OF_CUSTODY",
  ]),
  canCheckin: z.boolean(),
  leaveWorkflowEligible: z.boolean(),
  geofenceApplicable: z.boolean(),
})
