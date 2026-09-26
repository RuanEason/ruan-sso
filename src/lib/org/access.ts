import { prisma } from "@/lib/db"

/** Whether a user may use an OAuth client based on organization binding. */
export async function userCanAccessClient(
  userId: string,
  clientDbId: string,
  allowAllOrganizations: boolean
): Promise<boolean> {
  if (allowAllOrganizations) return true

  const bindings = await prisma.oAuthClientOrganization.findMany({
    where: { clientId: clientDbId },
    select: { organizationId: true },
  })

  // No binding + not allow-all → deny (must explicitly configure)
  if (bindings.length === 0) return false

  const orgIds = bindings.map((b) => b.organizationId)
  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId: { in: orgIds },
      organization: { status: "ACTIVE" },
    },
  })
  return !!membership
}
