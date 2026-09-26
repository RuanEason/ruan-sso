/**
 * Rotates the RUAN SSO RS256 signing key.
 *
 *   npm run keys:rotate            # rotate for real
 *   npm run keys:rotate -- --dry-run
 *
 * Why this exists: rotation is the only way to stop the bleeding when a private
 * key leaks. Before this script the procedure was hand-written SQL, which meant
 * it was slow and easy to get wrong at exactly the moment it mattered most.
 *
 * Two rules the script refuses to break:
 *
 *   1. The old key is NEVER deleted. Access and id tokens live for 1 hour
 *      (ACCESS_TOKEN_TTL_SEC), so deleting a key the instant it is replaced
 *      would invalidate every token in flight and sign out every online user.
 *      The retired key is kept, and `buildJwks()` keeps publishing it, so
 *      tokens signed before the rotation still verify.
 *   2. Nothing is written to the database until the new keypair has been
 *      generated successfully, and both the insert and the retire happen in a
 *      single transaction. A half-applied rotation would leave the deployment
 *      signing with a key the JWKS does not publish.
 *
 * The private half of the new keypair is printed for you to paste into the
 * environment and is never written to the database or to disk.
 */
import "./ts-alias.mjs"
import "dotenv/config"
import { generateKeyPair, exportPKCS8, exportSPKI, exportJWK, calculateJwkThumbprint } from "jose"
import { PrismaClient } from "@prisma/client"

import { loadSigningKey } from "@/lib/auth/keys"

/** Must match ACCESS_TOKEN_TTL_SEC in src/lib/env.ts. */
const TOKEN_TTL_MS = 60 * 60 * 1000

const dryRun = process.argv.includes("--dry-run")
const prisma = new PrismaClient()

function banner(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`)
}

/** .env values must be single-line; JSON-style \n escapes are unescaped by env.ts. */
const oneLine = (pem) => pem.trim().replace(/\n/g, "\\n")

const iso = (date) => date.toISOString().replace(".000Z", "Z")

let exitCode = 0

try {
  banner(dryRun ? "RUAN SSO key rotation (DRY RUN — no database writes)" : "RUAN SSO key rotation")

  // 1. The key currently in the environment. This also validates the PEMs: a
  //    malformed key must fail here, before anything is generated or written.
  const current = await loadSigningKey()
  console.log(`current signing key (from JWT_PRIVATE_KEY_PEM)`)

  // 2. What the database believes. The environment and the registry can drift —
  //    most easily by editing .env without restarting the server, or by running
  //    a rotation and forgetting to redeploy the new environment. Surface that
  //    instead of silently papering over it.
  const activeRows = await prisma.signingKey.findMany({
    where: { status: "ACTIVE" },
    select: { kid: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  const registered = activeRows.find((row) => row.kid === current.kid)
  console.log(`  kid       ${current.kid}`)
  console.log(`  alg       ${current.alg}`)
  console.log(`  ACTIVE rows in SigningKey: ${activeRows.length}`)

  if (!registered) {
    console.log(
      `\n  WARNING: this kid is not registered as ACTIVE in SigningKey.\n` +
        `  The environment and the database are out of sync. Common causes:\n` +
        `    - .env was changed but the server was not restarted\n` +
        `    - a previous rotation was applied without redeploying the new keys\n` +
        `  Rotating now is still safe: it registers the new key and retires every\n` +
        `  currently-ACTIVE row below.`
    )
  }

  // 3. Generate the replacement keypair. Doing this before any write means a
  //    failure here leaves the database completely untouched.
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
    modulusLength: 2048,
  })
  const privatePem = await exportPKCS8(privateKey)
  const publicPem = await exportSPKI(publicKey)
  const newJwk = await exportJWK(publicKey)

  // The kid is the RFC 7638 JWK thumbprint, computed by the same helper the
  // server uses, so it is guaranteed to match what the JWKS advertises.
  const newKid = await calculateJwkThumbprint(newJwk)

  console.log(`\nnew signing key`)
  console.log(`  kid       ${newKid}`)
  console.log(`  alg       RS256 (2048-bit)`)

  if (newKid === current.kid) {
    // Effectively impossible with a 2048-bit RSA key, but a rotation that
    // "succeeds" while producing the same key would be a silent security hole.
    throw new Error("generated key is identical to the current key; aborting")
  }

  const retiring = activeRows.filter((row) => row.kid !== newKid)

  console.log(`\nplan`)
  console.log(`  1. INSERT SigningKey kid=${newKid} status=ACTIVE`)
  if (retiring.length === 0) {
    console.log(`  2. retire  (nothing ACTIVE to retire)`)
  } else {
    for (const row of retiring) {
      console.log(`  2. RETIRE SigningKey kid=${row.kid} retiredAt=now()`)
    }
  }
  console.log(`  3. print the new JWT_PRIVATE_KEY_PEM / JWT_PUBLIC_KEY_PEM`)
  console.log(`  (no row is ever deleted)`)

  if (dryRun) {
    banner("DRY RUN — nothing was written")
    console.log(`Re-run without --dry-run to apply this rotation.\n`)
  } else {
    // 4. Apply atomically. If either statement fails, neither is visible.
    const retiredAt = new Date()

    const [, retiredCount] = await prisma.$transaction([
      prisma.signingKey.upsert({
        where: { kid: newKid },
        update: { publicJwk: newJwk, alg: "RS256", status: "ACTIVE", retiredAt: null },
        create: { kid: newKid, alg: "RS256", publicJwk: newJwk, status: "ACTIVE" },
      }),
      prisma.signingKey.updateMany({
        where: { kid: { in: retiring.map((row) => row.kid) } },
        data: { status: "RETIRED", retiredAt },
      }),
    ])

    console.log(`\napplied: 1 key registered ACTIVE, ${retiredCount.count} key(s) RETIRED`)

    // 5. Hand over the material to deploy.
    const earliestCleanup = new Date(retiredAt.getTime() + TOKEN_TTL_MS)

    banner("PASTE INTO THE ENVIRONMENT")
    console.log(`JWT_PRIVATE_KEY_PEM="${oneLine(privatePem)}"
JWT_PUBLIC_KEY_PEM="${oneLine(publicPem)}"`)

    banner("AFTER DEPLOYING")
    console.log(`Retired kid        ${retiring.map((r) => r.kid).join(", ") || "(none)"}`)
    console.log(`Retired at         ${iso(retiredAt)}`)
    console.log(`Earliest cleanup   ${iso(earliestCleanup)}  (retiredAt + 1h)`)
    console.log(`
Do NOT reset JWT_ALLOW_HS256. It is false for a reason; see docs/key-management.md.

RESTART IS MANDATORY. Next.js caches already-loaded environment variables in the
running process, so a server that has read the old key keeps signing with it even
after .env changes. Until you restart you will publish one key and sign with
another.

After restarting, confirm that BOTH kids are published (the retired one must stay
so in-flight tokens keep verifying):

  curl -s $APP_URL/.well-known/jwks.json | grep -o '"kid":"[^"]*"'

Expected: ${newKid}
          ${retiring.map((r) => r.kid).join("\n          ") || "(no retired key)"}

Do not delete the retired row before ${iso(earliestCleanup)}. Tokens signed with it
remain valid until then, and deleting it early signs every online user out.`)
  }
} catch (error) {
  console.error(`\nROTATION FAILED: ${error.message}`)
  exitCode = 1
} finally {
  await prisma.$disconnect()
}

process.exit(exitCode)
