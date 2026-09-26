/**
 * Generates an RS256 keypair for RUAN SSO and prints the PEM values to paste
 * into .env.
 *
 *   npm run keys:generate
 *
 * The private key must never be committed or shared with relying parties. Only
 * the public key is published (via /.well-known/jwks.json), which is precisely
 * why third-party clients no longer need any shared secret.
 */
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose"

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
  modulusLength: 2048,
})

const privatePem = await exportPKCS8(privateKey)
const publicPem = await exportSPKI(publicKey)

// .env values must be single-line; JSON-style \n escapes are unescaped by env.ts.
const oneLine = (pem) => pem.trim().replace(/\n/g, "\\n")

console.log(`# --- paste into .env ---
JWT_PRIVATE_KEY_PEM="${oneLine(privatePem)}"
JWT_PUBLIC_KEY_PEM="${oneLine(publicPem)}"
JWT_ALLOW_HS256="false"
# --- end ---

# Keypair generated. Keep JWT_PRIVATE_KEY_PEM secret: anyone holding it can
# mint tokens for every user and every client.
`)
