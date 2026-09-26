/**
 * Removes RETIRED signing keys whose grace period has elapsed.
 *
 *   npm run keys:prune              # report what is eligible, delete nothing
 *   npm run keys:prune -- --apply   # actually delete
 *
 * This closes the last manual step in the rotation procedure. `keys:rotate`
 * retires the previous key but deliberately keeps it, because tokens signed
 * with it stay valid for ACCESS_TOKEN_TTL_SEC (1 hour) after rotation. Until
 * that window closes, deleting the key would sign every online user out. This
 * script is what removes it afterwards — the "when can I delete this" question
 * `keys:rotate` answers in its output.
 *
 * Deletion is irreversible and easy to get wrong by hand, so:
 *
 *   - dry-run is the DEFAULT; deleting requires an explicit `--apply`
 *   - only rows that are RETIRED *and* past `retiredAt + 1h` are eligible
 *   - ACTIVE rows are never eligible, under any flag
 */
import "./ts-alias.mjs"
import "dotenv/config"
import { PrismaClient } from "@prisma/client"

import { TOKEN_TTL_MS, partitionRetiredKeys } from "@/lib/auth/key-lifecycle"

const apply = process.argv.includes("--apply")
const prisma = new PrismaClient()

function banner(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`)
}

const iso = (date) => date.toISOString().replace(".000Z", "Z")

let exitCode = 0

try {
  banner(apply ? "RUAN SSO key pruning (APPLY)" : "RUAN SSO key pruning (dry run)")

  const now = new Date()

  const rows = await prisma.signingKey.findMany({
    select: { kid: true, status: true, createdAt: true, retiredAt: true },
    orderBy: { createdAt: "asc" },
  })

  const active = rows.filter((row) => row.status === "ACTIVE")
  const retired = rows.filter((row) => row.status === "RETIRED")
  const { eligible, tooEarly } = partitionRetiredKeys(retired, now)

  console.log(`now                ${iso(now)}`)
  console.log(`total keys         ${rows.length}`)
  console.log(`  ACTIVE           ${active.length}${active.length ? `  (${active.map((r) => r.kid).join(", ")})` : ""}`)
  console.log(`  RETIRED          ${retired.length}`)

  if (tooEarly.length) {
    console.log(`\nstill inside the 1h grace period — NOT eligible:`)
    for (const row of tooEarly) {
      console.log(`  ${row.kid}`)
      console.log(
        row.deletableAt
          ? `    ${row.reason}, deletable at ${iso(row.deletableAt)}`
          : `    ${row.reason}`
      )
    }
  }

  if (eligible.length === 0) {
    banner("NOTHING TO PRUNE")
    console.log(
      `Every retired key is either still within its grace period or already gone.\n` +
        `Tokens signed by a retired key stay valid for 1h after retirement, so this\n` +
        `is the expected state immediately after a rotation.\n`
    )
  } else if (!apply) {
    banner("DRY RUN — nothing was deleted")
    console.log(`Would delete ${eligible.length} key(s):\n`)
    for (const row of eligible) {
      console.log(`  ${row.kid}`)
      console.log(`    retiredAt   ${iso(row.retiredAt)}`)
      console.log(`    deletableAt ${iso(row.deletableAt)}  (grace period elapsed)`)
    }
    console.log(
      `\nRe-run with --apply to delete these. Before doing so, confirm that no\n` +
        `token issued under them can still be presented: they were retired more\n` +
        `than 1h ago, so any such token has already expired.`
    )
  } else {
    // Re-check inside the delete itself so a concurrent rotation cannot widen
    // the set between the read above and the write.
    const cutoff = new Date(now.getTime() - TOKEN_TTL_MS)
    const result = await prisma.signingKey.deleteMany({
      where: {
        status: "RETIRED",
        retiredAt: { not: null, lte: cutoff },
      },
    })

    banner("PRUNED")
    for (const row of eligible) {
      console.log(`  deleted ${row.kid}`)
    }
    console.log(`\ndeleted ${result.count} key(s)`)
    if (result.count !== eligible.length) {
      // The re-check above is deliberately narrower than the read, so this can
      // only differ if something changed the table concurrently.
      console.log(
        `\nNOTE: expected ${eligible.length} but deleted ${result.count}. The registry\n` +
          `changed while this ran; re-run without --apply to see the current state.`
      )
    }
    console.log(
      `\nACTIVE keys are never eligible and were untouched.\n` +
        `If a relying party cached the JWKS, it may still reference these kids until\n` +
        `its cache expires (Cache-Control: max-age=3600). That is harmless: a kid\n` +
        `that no longer appears can no longer validate anything, and every token it\n` +
        `signed has expired.`
    )
  }
} catch (error) {
  console.error(`\nPRUNE FAILED: ${error.message}`)
  exitCode = 1
} finally {
  await prisma.$disconnect()
}

process.exit(exitCode)
