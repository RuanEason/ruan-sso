/**
 * Lets the plain-Node scripts in `scripts/` reuse the app's real TypeScript
 * source instead of reimplementing it.
 *
 * Why this is needed: npm runs a bare `node scripts/*.mjs` with no loader, so
 * Node's ESM resolver applies its normal rules — a `.ts` file cannot be resolved
 * by an extensionless specifier. The scripts that DO import app code
 * (prisma/seed.ts, scripts/verify-keys.mjs) get away with it only because `tsx`
 * or a bundler is doing the work.
 *
 * The alternative — copying `loadSigningKey` / `computeKid` into the rotation
 * script — is exactly the kind of duplication that lets a rotation script and the
 * running server disagree about a `kid`, which is the one thing this whole
 * feature depends on.
 *
 * Node 24 strips TypeScript types natively, so no transpiler is required; the
 * only missing pieces are tsconfig's `paths` alias and file extensions. Two
 * mappings are needed:
 *
 *   @/*       - the app's own alias, so src/ keeps working unchanged.
 *   ./*.ts    - Node requires the real extension, while the app's own imports
 *               are extensionless (bundler resolution).
 *
 * `registerHooks` (synchronous) rather than `module.register` avoids a separate
 * loader thread, which the app's sandboxed environments do not always allow.
 */
import { registerHooks } from "node:module"
import { statSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SRC = new URL("../src/", import.meta.url)

/** Resolves a specifier against candidates that exist on disk. */
function firstExisting(base, candidates) {
  for (const candidate of candidates) {
    const url = new URL(candidate, base)
    try {
      statSync(fileURLToPath(url))
      return url.href
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `@/lib/foo` -> `src/lib/foo.ts`, mirroring tsconfig `paths`.
    if (specifier.startsWith("@/")) {
      const rest = specifier.slice("@/".length)
      const url = firstExisting(SRC, [rest, `${rest}.ts`, `${rest}.tsx`, `${rest}/index.ts`])
      if (url) return { url, shortCircuit: true }
      throw new Error(`ts-alias: cannot resolve "${specifier}" under ${SRC.href}`)
    }

    // Relative imports inside src/ are written extensionless (or with the ESM
    // `.js` convention); Node needs a real path, so find the file on disk.
    if (specifier.startsWith(".") && context.parentURL?.startsWith(SRC.href)) {
      const withoutExtension = specifier.replace(/\.(js|mjs|cjs|ts|tsx)$/, "")
      const url = firstExisting(context.parentURL, [
        specifier,
        `${withoutExtension}.ts`,
        `${withoutExtension}.tsx`,
      ])
      if (url) return { url, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  },
})
