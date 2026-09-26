/**
 * Repairs a package-lock.json that was generated on Windows.
 *
 * npm resolves optional platform packages for the HOST platform only, so a
 * Windows-generated lockfile records the `@unrs/*` and `@img/*` platform
 * entries but omits the transitive dependencies of the non-Windows ones.
 * `npm ci` on Linux then fails with:
 *
 *   Missing: @emnapi/runtime@1.11.3 from lock file
 *   Missing: @emnapi/core@1.11.3 from lock file
 *
 * This script finds every locked package whose declared dependencies are
 * missing from the lock, fetches the authoritative metadata from the registry,
 * and inserts the missing entries (recursively, in case those have their own
 * missing dependencies).
 *
 * Usage: node scripts/fix-lockfile.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"
import semver from "semver"

const LOCK = "package-lock.json"
const REGISTRY = "https://registry.npmjs.org"

const lock = JSON.parse(readFileSync(LOCK, "utf8"))

/** Parse "name@range" style specifiers npm writes into package entries. */
function depPath(name) {
  return `node_modules/${name}`
}

/** The lockfile pins platform-package deps exactly, but ranges occur too. */
function exactVersion(spec) {
  return /^\d+\.\d+\.\d+/.test(spec) ? spec : null
}

/**
 * Picks the highest published version satisfying a range.
 *
 * Ranges appear when a WASM-fallback package declares a caret dependency, so
 * resolving them requires the full packument rather than a single version.
 */
async function resolveRange(name, range) {
  const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`)
  if (!res.ok) throw new Error(`registry ${res.status} for ${name}`)
  const packument = await res.json()

  const versions = Object.keys(packument.versions ?? {}).filter((v) => !v.includes("-"))
  return semver.maxSatisfying(versions, range, { includePrerelease: false })
}

async function fetchMeta(name, version) {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}/${version}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`registry ${res.status} for ${name}@${version}`)
  return res.json()
}

/**
 * True when the lockfile can satisfy `name@spec` for a locked parent.
 *
 * A nested copy counts only if its version actually satisfies the range, and
 * only for the parent it sits under — `require` resolution walks up from the
 * requiring package, so a sibling package's nested copy is not reachable.
 */
function isSatisfied(name, spec, parentPath) {
  const candidates = []

  // npm hoists to the root when possible.
  const root = lock.packages[depPath(name)]
  if (root) candidates.push(root.version)

  // Otherwise a copy nested under the requiring package (or an ancestor of it).
  let scope = parentPath
  while (scope) {
    const nested = lock.packages[`${scope}/node_modules/${name}`]
    if (nested) {
      candidates.push(nested.version)
      break
    }
    const cut = scope.lastIndexOf("/node_modules/")
    scope = cut === -1 ? "" : scope.slice(0, cut)
  }

  return candidates.some((v) => {
    try {
      return semver.satisfies(v, spec, { includePrerelease: true })
    } catch {
      return v === spec
    }
  })
}

const added = []
const queue = []

// Seed the queue with every dependency declared by a locked package whose
// entry is absent from the lock.
for (const [parentPath, entry] of Object.entries(lock.packages)) {
  for (const [name, spec] of Object.entries(entry.dependencies ?? {})) {
    if (!isSatisfied(name, spec, parentPath)) {
      queue.push({ name, spec, requiredBy: parentPath })
    }
  }
}

console.log(`found ${queue.length} unresolved dependency reference(s)`)

const seen = new Set()

while (queue.length) {
  const { name, spec, requiredBy } = queue.shift()
  const version = exactVersion(spec) ?? (await resolveRange(name, spec))
  if (!version) {
    console.warn(`  skip ${name}@${spec} (unresolvable, required by ${requiredBy})`)
    continue
  }
  const key = `${name}@${version}`
  if (seen.has(key)) continue
  seen.add(key)

  const path = depPath(name)
  // Note: an existing root entry at a DIFFERENT version must not skip this —
  // the requirer needs its own nested copy, which is handled below.
  const hoisted = lock.packages[path]
  if (hoisted && hoisted.version === version) continue

  const meta = await fetchMeta(name, version)
  const entry = {
    version: meta.version,
    resolved: meta.dist.tarball,
    integrity: meta.dist.integrity,
    license: meta.license,
  }
  // Preserve the platform guards, which keep these optional packages from
  // being installed on platforms that do not need them.
  for (const field of ["cpu", "os", "libc", "dev", "optional", "bundled"]) {
    if (meta[field] !== undefined) entry[field] = meta[field]
  }
  if (meta.dependencies && Object.keys(meta.dependencies).length) {
    entry.dependencies = meta.dependencies
  }
  if (meta.optionalDependencies) {
    entry.optionalDependencies = meta.optionalDependencies
  }
  if (meta.peerDependencies) entry.peerDependencies = meta.peerDependencies
  if (meta.bin) entry.bin = meta.bin
  if (meta.engines) entry.engines = meta.engines

  // A version that conflicts with an existing hoisted one is nested under the
  // requiring package, which is what npm itself would do.
  const finalPath =
    hoisted && hoisted.version !== version
      ? `${requiredBy}/node_modules/${name}`
      : path
  if (lock.packages[finalPath]) continue

  lock.packages[finalPath] = entry
  added.push(`${key} -> ${finalPath}`)
  console.log(`  added ${key} at ${finalPath}`)

  for (const [childName, childSpec] of Object.entries(meta.dependencies ?? {})) {
    if (!isSatisfied(childName, childSpec, finalPath)) {
      queue.push({ name: childName, spec: childSpec, requiredBy: finalPath })
    }
  }
}

if (added.length) {
  // Keep the object keys in a stable, npm-like sorted order.
  const sorted = {}
  for (const k of Object.keys(lock.packages).sort()) sorted[k] = lock.packages[k]
  lock.packages = sorted
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n")
  console.log(`\nwrote ${LOCK} with ${added.length} new entr(ies)`)
} else {
  console.log("\nnothing to add")
}
