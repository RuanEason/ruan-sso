import { auditKeyHealth } from "@/lib/auth/key-lifecycle"

/**
 * Startup self-check for the signing key configuration.
 *
 * Editing `.env` without restarting leaves the running process signing with the
 * old key while the JWKS advertises the new one — a state that is invisible from
 * the server's side and only shows up as verification failures at relying
 * parties. This check makes that drift loud at startup instead.
 *
 * It only LOGS. A key mismatch degrades token verification but does not stop
 * logins or session handling, so refusing to boot would turn a warning into an
 * outage. Operators get the diagnosis and decide.
 */
async function checkSigningKeyHealth(): Promise<void> {
  // Imported lazily: a failure here must never prevent the server from starting,
  // including when the database is unreachable during boot.
  const { prisma } = await import("@/lib/db")
  const { buildJwks, getPublicJwk } = await import("@/lib/auth/keys")

  const rows = await prisma.signingKey.findMany({
    select: { kid: true, status: true, retiredAt: true },
  })

  let envKid: string | null = null
  try {
    envKid = String((await getPublicJwk()).kid)
  } catch {
    // getPublicJwk throws when the PEMs are absent or malformed; the audit
    // reports that as env-key-not-registered.
    envKid = null
  }

  const jwksKids = (await buildJwks()).keys.map((key) => String(key.kid))

  const issues = auditKeyHealth({ envKid, rows, jwksKids, now: new Date() })
  if (issues.length === 0) return

  const errors = issues.filter((issue) => issue.severity === "error")
  const label = errors.length ? "SIGNING KEY PROBLEM" : "SIGNING KEY WARNING"

  console.warn(`\n${"!".repeat(72)}`)
  console.warn(`${label} — ${issues.length} issue(s) detected at startup`)
  console.warn(`${"!".repeat(72)}`)
  for (const issue of issues) {
    console.warn(`  [${issue.severity.toUpperCase()}] ${issue.code}`)
    console.warn(`  ${issue.message}`)
  }
  console.warn(
    `\n  env kid : ${envKid ?? "(unreadable)"}\n` +
      `  JWKS    : ${jwksKids.join(", ") || "(none)"}\n` +
      `\n  Run \`npm run keys:health\` for a full report.\n` +
      `  See docs/key-management.md.\n${"!".repeat(72)}\n`
  )
}

export async function register(): Promise<void> {
  // instrumentation runs in every runtime, and Prisma is unavailable on Edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  try {
    await checkSigningKeyHealth()
  } catch (error) {
    // Never let a diagnostic break startup.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`signing key health check could not run: ${message}`)
  }
}
