/**
 * Restores the "project-context" block in AGENTS.md from a pristine backup.
 *
 * Why this exists: the project-context block is meant to be edited by AI
 * sessions — corrected, annotated, extended. That freedom needs a way back, so
 * the block as first written is kept verbatim in
 * `docs/agent-context-backup.md`. This script swaps the live block back to that
 * copy while leaving the rest of AGENTS.md untouched.
 *
 * Only the region between the BEGIN:project-context and END:project-context
 * markers is replaced. The `nextjs-agent-rules` block above it is written and
 * maintained by `next dev` and must not be disturbed.
 *
 * Usage:
 *   node scripts/restore-agent-context.mjs          # restore
 *   node scripts/restore-agent-context.mjs --dry    # show what would change
 *
 * Not part of CI: it is a manual recovery tool.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const AGENTS = join(root, "AGENTS.md")
const BACKUP = join(root, "docs", "agent-context-backup.md")

const BEGIN = "<!-- BEGIN:project-context"
const END = "<!-- END:project-context"

function extractBlock(content, begin, end) {
  const start = content.indexOf(begin)
  if (start === -1) return null
  const endIdx = content.indexOf(end, start)
  if (endIdx === -1) return null
  // Cut the line containing the end marker, inclusive.
  const lineEnd = content.indexOf("\n", endIdx)
  return {
    start,
    end: lineEnd === -1 ? content.length : lineEnd + 1,
  }
}

const agents = readFileSync(AGENTS, "utf8")
const backup = readFileSync(BACKUP, "utf8")

const live = extractBlock(agents, BEGIN, END)
if (!live) {
  console.error(
    `Could not find the project-context block in AGENTS.md.\n` +
      `Expected a line starting with "${BEGIN}".\n` +
      `The file may have been damaged; restore it from git instead:\n` +
      `  git log --oneline -- AGENTS.md\n` +
      `  git show <commit>:AGENTS.md > AGENTS.md`
  )
  process.exit(1)
}

const backupBlock = backup.trimEnd() + "\n"
const restored = agents.slice(0, live.start) + backupBlock + agents.slice(live.end)

if (restored === agents) {
  console.log("Already identical to the backup; nothing to do.")
  process.exit(0)
}

if (process.argv.includes("--dry")) {
  console.log("Would replace AGENTS.md lines covering the project-context block.")
  console.log(`  current block: ${agents.slice(live.start, live.end).split("\n").length} lines`)
  console.log(`  backup block : ${backupBlock.split("\n").length} lines`)
  process.exit(0)
}

writeFileSync(AGENTS, restored, "utf8")
console.log("Restored AGENTS.md project-context block from docs/agent-context-backup.md")
