import { describe, expect, it, vi } from "vitest"

import { portalScopesFor, visibleAppsForUser, type PortalClient } from "@/lib/portal"

/**
 * The portal decides what a user sees; `userCanAccessClient` decides what the
 * authorize endpoint actually allows. If the two disagree, a user gets the worst
 * kind of experience: a card they can click and be refused on.
 *
 * To make that disagreement impossible to ship, the enforcement helpers are
 * exercised here for real (Prisma is mocked, the logic is not) and the portal's
 * answers are asserted against them directly.
 */
const memberFindFirst = vi.fn()
const bindingFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    organizationMember: {
      findFirst: (...args: unknown[]) => memberFindFirst(...args),
    },
    oAuthClientOrganization: {
      findMany: (...args: unknown[]) => bindingFindMany(...args),
    },
  },
}))

const { userCanAccessClient } = await import("@/lib/org/access")

const DEFAULTS = ["openid", "profile", "email"] as const

function client(overrides: Partial<PortalClient> = {}): PortalClient {
  return {
    id: "db-1",
    clientId: "app-1",
    name: "App One",
    allowedScopes: "openid profile email",
    allowAllOrganizations: false,
    status: "ACTIVE",
    organizationIds: [],
    ...overrides,
  }
}

/**
 * Runs both implementations over the same fixture and returns whether the
 * portal showed the app and whether enforcement would allow it.
 */
async function agreement(
  c: PortalClient,
  userOrgIds: string[]
): Promise<{ visible: boolean; allowed: boolean }> {
  const visible = visibleAppsForUser([c], new Set(userOrgIds), DEFAULTS).length > 0

  // Mirror the fixture onto the mocked Prisma calls userCanAccessClient makes.
  bindingFindMany.mockResolvedValue(
    c.organizationIds.map((organizationId) => ({ organizationId }))
  )
  memberFindFirst.mockResolvedValue(
    c.organizationIds.some((id) => userOrgIds.includes(id)) ? { id: "m-1" } : null
  )

  const allowed = await userCanAccessClient("user-1", c.id, c.allowAllOrganizations)
  return { visible, allowed }
}

describe("visibleAppsForUser", () => {
  it("shows an allow-all client to everyone", () => {
    const apps = visibleAppsForUser(
      [client({ allowAllOrganizations: true })],
      new Set(),
      DEFAULTS
    )
    expect(apps.map((a) => a.clientId)).toEqual(["app-1"])
  })

  it("hides a client bound to no organization when allow-all is off", () => {
    // Matches userCanAccessClient: with no binding, access must be configured
    // explicitly, so nobody may see it. Showing it would be a dead card.
    const apps = visibleAppsForUser([client()], new Set(["org-1"]), DEFAULTS)
    expect(apps).toEqual([])
  })

  it("shows a client only to members of a bound organization", () => {
    const bound = client({ organizationIds: ["org-1", "org-2"] })
    expect(
      visibleAppsForUser([bound], new Set(["org-1"]), DEFAULTS).map((a) => a.clientId)
    ).toEqual(["app-1"])
    expect(visibleAppsForUser([bound], new Set(["org-9"]), DEFAULTS)).toEqual([])
    expect(visibleAppsForUser([bound], new Set(), DEFAULTS)).toEqual([])
  })

  it("never shows a disabled client", () => {
    // An allow-all-but-disabled client must still be hidden; the authorize
    // endpoint rejects it as an unknown client.
    const apps = visibleAppsForUser(
      [client({ allowAllOrganizations: true, status: "DISABLED" })],
      new Set(),
      DEFAULTS
    )
    expect(apps).toEqual([])
  })

  it("sorts by name so the grid is stable between visits", () => {
    const apps = visibleAppsForUser(
      [
        client({ id: "1", clientId: "b", name: "Beta", allowAllOrganizations: true }),
        client({ id: "2", clientId: "a", name: "Alpha", allowAllOrganizations: true }),
      ],
      new Set(),
      DEFAULTS
    )
    expect(apps.map((a) => a.name)).toEqual(["Alpha", "Beta"])
  })
})

describe("portal and enforcement agree on every fixture", () => {
  const cases: Array<{ label: string; c: PortalClient; orgs: string[] }> = [
    {
      label: "allow-all client, user in no organization",
      c: client({ allowAllOrganizations: true }),
      orgs: [],
    },
    {
      label: "allow-all client, user in an organization",
      c: client({ allowAllOrganizations: true }),
      orgs: ["org-1"],
    },
    {
      label: "bound client, member of a bound organization",
      c: client({ organizationIds: ["org-1"] }),
      orgs: ["org-1", "org-2"],
    },
    {
      label: "bound client, member of an unbound organization",
      c: client({ organizationIds: ["org-1"] }),
      orgs: ["org-9"],
    },
    {
      label: "bound client, no memberships at all",
      c: client({ organizationIds: ["org-1"] }),
      orgs: [],
    },
    {
      label: "unbound client with allow-all off",
      c: client(),
      orgs: ["org-1"],
    },
    {
      label: "bound client, one of two bindings matched",
      c: client({ organizationIds: ["org-1", "org-2"] }),
      orgs: ["org-2"],
    },
  ]

  for (const { label, c, orgs } of cases) {
    it(label, async () => {
      const { visible, allowed } = await agreement(c, orgs)
      // The invariant: the portal shows exactly what enforcement permits.
      expect(visible).toBe(allowed)
    })
  }
})

describe("portalScopesFor", () => {
  it("requests the client's configured scopes", () => {
    expect(portalScopesFor("openid profile", DEFAULTS)).toBe("openid profile")
  })

  it("falls back to the default scope set when the client configures none", () => {
    // The validator defaults an empty scope to the default set; sending
    // `scope=` would instead fail its "scope must include openid" check.
    expect(portalScopesFor("", DEFAULTS)).toBe("openid profile email")
    expect(portalScopesFor("   ", DEFAULTS)).toBe("openid profile email")
  })

  it("always includes openid, which this protocol requires", () => {
    // A client configured without openid cannot be used to sign in; requesting
    // it anyway would be rejected with invalid_scope, so the portal must not
    // build that request.
    expect(portalScopesFor("profile email", DEFAULTS)).toBe(
      "openid profile email"
    )
  })
})
