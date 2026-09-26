import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import { ensureSigningKeyRegistered, loadSigningKey } from "../src/lib/auth/keys"

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12)

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "admin@ruan.local",
      passwordHash,
      displayName: "RUAN Admin",
      role: "ADMIN",
      status: "ACTIVE",
    },
  })

  const enterprise = await prisma.organization.upsert({
    where: { slug: "enterprise" },
    update: {},
    create: {
      slug: "enterprise",
      name: "企业组织",
      description: "企业内部成员与应用，需管理员邀请加入。",
      type: "ENTERPRISE",
      status: "ACTIVE",
      allowSelfRegister: false,
    },
  })

  const group = await prisma.organization.upsert({
    where: { slug: "circle" },
    update: {},
    create: {
      slug: "circle",
      name: "团体组织",
      description: "特定团体/圈子，成员由管理员管理。",
      type: "GROUP",
      status: "ACTIVE",
      allowSelfRegister: false,
    },
  })

  const publicOrg = await prisma.organization.upsert({
    where: { slug: "public" },
    update: { allowSelfRegister: true },
    create: {
      slug: "public",
      name: "公开组织",
      description: "对外开放，允许自助注册加入。",
      type: "PUBLIC",
      status: "ACTIVE",
      allowSelfRegister: true,
    },
  })

  for (const org of [enterprise, group, publicOrg]) {
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: admin.id,
        },
      },
      update: { role: "OWNER" },
      create: {
        organizationId: org.id,
        userId: admin.id,
        role: "OWNER",
      },
    })
  }

  const demoSecret = "demo-client-secret"
  const clientSecretHash = await bcrypt.hash(demoSecret, 12)

  const client = await prisma.oAuthClient.upsert({
    where: { clientId: "ruan-demo-app" },
    update: { allowAllOrganizations: true },
    create: {
      clientId: "ruan-demo-app",
      clientSecretHash,
      name: "RUAN Demo App",
      redirectUris: ["http://localhost:4000/callback", "http://127.0.0.1:4000/callback"],
      allowedScopes: "openid profile email",
      isConfidential: true,
      allowAllOrganizations: true,
      status: "ACTIVE",
    },
  })

  console.log("Seed complete")
  console.log({
    admin: { username: admin.username, password: "admin123" },
    organizations: [
      { slug: enterprise.slug, type: enterprise.type },
      { slug: group.slug, type: group.type },
      { slug: publicOrg.slug, type: publicOrg.type, selfRegister: true },
    ],
    client: {
      clientId: client.clientId,
      clientSecret: demoSecret,
      allowAllOrganizations: true,
    },
  })

  // Publish the configured RS256 public key so JWKS clients can verify tokens.
  const signingKey = await loadSigningKey()
  await ensureSigningKeyRegistered(signingKey.kid)
  console.log({ signingKey: { kid: signingKey.kid, alg: signingKey.alg } })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
