import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/**
 * Unit tests cover the pure, security-critical logic (protocol validation,
 * PKCE, token hashing, input sanitisation). They deliberately need no database,
 * no dev server and no browser, so they run in milliseconds and can gate every
 * commit.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
