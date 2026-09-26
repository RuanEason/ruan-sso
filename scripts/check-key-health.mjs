/**
 * Audits the signing key setup: environment, registry and published JWKS.
 *
 *   npm run keys:health
 *
 * Exits non-zero when anything is wrong, so it can gate a deploy or run as a
 * post-rotation smoke test.
 *
 * It answers the question that a plain `curl /.well-known/jwks.json` cannot:
 * does the key this process signs with actually match the key the registry
 * recognises and the JWKS advertises? Those three drifting apart is silent from
 * the server's point of view — only relying parties see the failures.
 */
import "./ts-alias.mjs"
import "dotenv/config"
import { importSPKI, exportJWK, calculateJwkThumbprint } from "jose"
import { PrismaClient } from "@prisma/client"

import { auditKeyHealth } from "@/lib/auth/key-lifecycle"
import { buildJwks } from "@/lib/auth/keys"

const prisma = new PrismaClient()

function banner(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`)
}

/** The kid the environment currently points at, or null if it cannot be read. */
async function readEnvKid() {
  const raw = process.env.JWT_PUBLIC_KEY_PEM
  if (!raw) return null
  try {
    const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
    return await calculateJwkThumbprint(await exportJWK(await importSPKI(pem, "RS256")))
  } catch {
    // A malformed PEM is reported by the audit as env-key-not-registered.
    return null
  }
}

let exitCode = 0

try {
  banner("RUAN SSO signing key health check")

  const rows = await prisma.signingKey.findMany({
    select: { kid: true, status: true, retiredAt: true },
    orderBy: { createdAt: "asc" },
  })

  const envKid = await readEnvKid()

  // buildJwks() is the real thing the endpoint serves, so the audit sees
  // exactly what relying parties see.
  const jwks = await buildJwks()
  const jwksKids = jwks.keys.map((key) => String(key.kid))

  const now = new Date()
  const issues = auditKeyHealth({ envKid, rows, jwksKids, now })

  console.log(`now              ${now.toISOString().replace(".000Z", "Z")}`)
  console.log(`env kid          ${envKid ?? "(unreadable)"}`)
  console.log(`registry         ${rows.length} row(s)`)
  for (const row of rows) {
    console.log(`  ${row.status.padEnd(8)} ${row.kid}`)
  }
  console.log(`JWKS             ${jwksKids.length} key(s) published`)
  for (const kid of jwksKids) {
    console.log(`  ${kid}`)
  }

  if (issues.length === 0) {
    banner("HEALTHY")
    console.log(`The environment, the registry and the JWKS all agree.\n`)
  } else {
    const errors = issues.filter((issue) => issue.severity === "error")

    banner(errors.length ? "UNHEALTHY" : "WARNINGS")
    for (const issue of issues) {
      console.log(`\n  [${issue.severity.toUpperCase()}] ${issue.code}`)
      console.log(`  ${issue.message}`)
    }
    console.log("")

    // Only errors fail the check. A stale retired key is a housekeeping nudge,
    // and immediately after a rotation it is the expected state.
    if (errors.length) exitCode = 1
  }
} catch (error) {
  console.error(`\nHEALTH CHECK FAILED: ${error.message}`)
  exitCode = 1
} finally {
  await prisma.$disconnect()
}

process.exit(exitCode)
