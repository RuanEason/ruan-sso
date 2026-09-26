import { getAppUrl } from "@/lib/env"
import { PUBLIC_DOC_PATHS } from "@/lib/docs/paths"
import { buildDiscoveryDocument } from "@/lib/oidc/discovery"
import { endpointUrl } from "@/lib/oidc/endpoints"

export { PUBLIC_DOC_PATHS, PUBLIC_MACHINE_DOC_PATHS } from "@/lib/docs/paths"

/**
 * Single source of truth for the RUAN SSO integration documentation.
 *
 * Both the human-readable page (`/admin/docs`) and the machine-readable
 * endpoints (`/admin/docs.txt`, `/admin/docs.json`) are generated from this
 * module, so an endpoint can never be documented differently from the one that
 * actually exists.
 *
 * Everything here must be verifiable against the implementation. Anything the
 * SSO does not support belongs in `LIMITATIONS`, not in a feature list.
 */

export type DocEndpoint = {
  method: string
  path: string
  summary: string
}

export type DocSection = {
  id: string
  title: string
}

/** Table of contents. The page renders sections in this order and uses the ids as anchors. */
export const SECTIONS: DocSection[] = [
  { id: "overview", title: "概览与协议能力" },
  { id: "endpoints", title: "端点一览" },
  { id: "discovery", title: "OIDC 发现" },
  { id: "prepare", title: "接入前准备" },
  { id: "pkce", title: "授权码 + PKCE 流程" },
  { id: "refresh", title: "刷新令牌" },
  { id: "scopes", title: "Scope 与 Claims" },
  { id: "organizations", title: "组织准入规则" },
  { id: "logout", title: "登出" },
  { id: "errors", title: "错误码与排查" },
  { id: "limits", title: "已知限制" },
]

export function getEndpoints(): DocEndpoint[] {
  const issuer = getAppUrl()
  return [
    {
      method: "GET",
      path: endpointUrl(issuer, "discovery"),
      summary: "OpenID Provider 元数据，客户端可据此自动配置端点",
    },
    {
      method: "GET",
      path: endpointUrl(issuer, "jwks"),
      summary: "公钥集（JWKS），客户端用它验签 id_token / access_token，无需任何共享密钥",
    },
    {
      method: "GET",
      path: endpointUrl(issuer, "authorize"),
      summary: "授权端点，浏览器跳转至此发起登录；必须携带 PKCE 参数",
    },
    {
      method: "POST",
      path: endpointUrl(issuer, "token"),
      summary: "令牌端点，用授权码或刷新令牌换取 token",
    },
    {
      method: "GET",
      path: endpointUrl(issuer, "userinfo"),
      summary: "用户信息端点，需携带 Bearer access_token",
    },
    {
      method: "GET / POST",
      path: endpointUrl(issuer, "logout"),
      summary: "登出端点，销毁当前 SSO 会话",
    },
  ]
}

export type DocScope = {
  name: string
  description: string
  claims: string[]
}

/** Mirrors DEFAULT_SCOPES in src/lib/env.ts. */
export const SCOPES: DocScope[] = [
  {
    name: "openid",
    description: "必选。声明这是一个 OIDC 请求，用于签发 id_token。",
    claims: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "at_hash"],
  },
  {
    name: "profile",
    description: "可选。返回基础资料字段。",
    claims: ["name", "preferred_username"],
  },
  {
    name: "email",
    description: "可选。返回邮箱字段，email_verified 恒为 true。",
    claims: ["email", "email_verified"],
  },
]

export type DocError = {
  code: string
  where: string
  cause: string
}

/** Derived from validate.ts, token.ts and consent/actions.ts. */
export const ERRORS: DocError[] = [
  {
    code: "invalid_request",
    where: "authorize",
    cause:
      "缺少 client_id / redirect_uri / code_challenge，或 redirect_uri 与注册值不完全一致，或 code_challenge_method 不是 S256",
  },
  {
    code: "invalid_client",
    where: "authorize / token",
    cause: "client_id 不存在或应用已被禁用；机密客户端未提供或提供了错误的 client_secret",
  },
  {
    code: "invalid_scope",
    where: "authorize",
    cause: "scope 未包含 openid，或请求了该应用 allowedScopes 之外的 scope",
  },
  {
    code: "unsupported_response_type",
    where: "authorize",
    cause: "response_type 不是 code（本实现不支持 implicit）",
  },
  {
    code: "access_denied",
    where: "authorize 回调",
    cause:
      "用户在同意页选择拒绝，或用户不属于该应用允许的组织（组织校验在自动跳过授权时同样生效）",
  },
  {
    code: "invalid_grant",
    where: "token",
    cause:
      "授权码已使用 / 已过期（10 分钟）/ 与 client 或 redirect_uri 不匹配 / PKCE 校验失败；或刷新令牌无效、已吊销、已过期",
  },
  {
    code: "unsupported_grant_type",
    where: "token",
    cause: "grant_type 不是 authorization_code 或 refresh_token",
  },
]

export const LIMITATIONS: string[] = [
  "不支持 implicit / client_credentials / device_code 等授权类型，仅支持 authorization_code 与 refresh_token。",
  "不支持 id_token_hint、prompt、login_hint、max_age 等参数。",
  "登出端点的 post_logout_redirect_uri 必须是该应用已注册的 redirect_uri 之一，且请求需携带 client_id；未注册的地址会被忽略并回落到登录页。",
  "同意页仅在「用户从未授权过该应用」或「本次请求的 scope 超出已授权范围」时展示；已覆盖的重复授权会被静默跳过，不再询问。用户可在 /account 撤销授权，撤销后下次登录将重新展示同意页。",
  "PKCE 为强制项且仅支持 S256，不支持 plain。",
  "登录接口的失败尝试次数限制保存在单进程内存中；多实例部署时每个实例各自计数，效果会按实例数放大。",
]

/** Copy-pasteable examples. Secrets are placeholders, never real credentials. */
export function getExamples() {
  const issuer = getAppUrl()
  return {
    pkce: `# 1. 生成 code_verifier 与 code_challenge（S256）
node -e "
const crypto = require('crypto');
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
console.log('code_verifier  =', verifier);
console.log('code_challenge =', challenge);
"`,

    authorizeUrl: `${endpointUrl(issuer, "authorize")}?response_type=code&client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&scope=openid%20profile%20email&state=<RANDOM_STATE>&nonce=<RANDOM_NONCE>&code_challenge=<CODE_CHALLENGE>&code_challenge_method=S256`,

    exchange: `curl -X POST ${endpointUrl(issuer, "token")} \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=<CODE>" \\
  -d "redirect_uri=<REDIRECT_URI>" \\
  -d "client_id=<CLIENT_ID>" \\
  -d "client_secret=<CLIENT_SECRET>" \\
  -d "code_verifier=<CODE_VERIFIER>"`,

    tokenResponse: `{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "…",
  "id_token": "eyJhbGciOiJIUzI1NiIs...",
  "scope": "openid profile email"
}`,

    refresh: `curl -X POST ${endpointUrl(issuer, "token")} \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=refresh_token" \\
  -d "refresh_token=<REFRESH_TOKEN>" \\
  -d "client_id=<CLIENT_ID>" \\
  -d "client_secret=<CLIENT_SECRET>"`,

    userinfo: `curl ${endpointUrl(issuer, "userinfo")} \\
  -H "Authorization: Bearer <ACCESS_TOKEN>"`,

    userinfoResponse: `{
  "sub": "cmxxxxxxxxxxxxxxxxxxxx",
  "name": "RUAN Admin",
  "preferred_username": "admin",
  "email": "admin@ruan.local",
  "email_verified": true
}`,

    logout: `# 浏览器跳转登出，可带 post_logout_redirect_uri 指定回跳地址
${endpointUrl(issuer, "logout")}?post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F`,

    verify: `import { createRemoteJWKSet, jwtVerify } from "jose"

// 只需公钥集地址，不需要任何共享密钥
const JWKS = createRemoteJWKSet(new URL("${endpointUrl(issuer, "jwks")}"))

const { payload } = await jwtVerify(idToken, JWKS, {
  issuer: "${issuer}",
  audience: "<CLIENT_ID>",
  algorithms: ["RS256"],
})

// 必须校验 nonce 与发起授权时生成的值一致，以防重放
if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch")

// at_hash 绑定同一响应中的 access_token；auth_time 为最终用户认证时间
if (typeof payload.auth_time !== "number") throw new Error("missing auth_time")`,

    jwksCurl: `curl ${endpointUrl(issuer, "jwks")}`,

    discoveryCurl: `curl ${endpointUrl(issuer, "discovery")}`,
  }
}

export type AiDocJson = {
  name: string
  description: string
  issuer: string
  discovery: ReturnType<typeof buildDiscoveryDocument>
  endpoints: DocEndpoint[]
  scopes: DocScope[]
  claims: string[]
  grants: string[]
  errors: DocError[]
  limitations: string[]
  humanReadableUrl: string
  machineReadableUrls: { text: string; json: string }
  notes: string[]
}

const NOTES: string[] = [
  "token 使用 RS256 非对称签名，公钥通过 " + endpointUrl(getAppUrl(), "jwks") + " 发布；客户端据此验签，不需要也不应持有任何共享密钥。",
  "PKCE 是强制项：缺少 code_challenge 的授权请求会被直接拒绝（invalid_request）。",
  "redirect_uri 必须与后台注册的值逐字符完全相同，不支持通配符或前缀匹配。",
  "授权码只能使用一次，有效期 10 分钟。",
  "access_token 与 id_token 有效期 1 小时；refresh_token 有效期 30 天。",
  "刷新令牌会轮换：每次刷新都会签发新的 refresh_token 并立即吊销旧的，客户端必须保存最新值。",
  "应用若未勾选「允许全部组织」且未绑定任何组织，则所有用户都会被拒绝访问。",
  "id_token 与 userinfo 的字段均按 scope 裁剪，未申请 profile / email 时不会返回对应字段。",
  "id_token 含 auth_time（最终用户认证时间，秒级 Unix 时间戳）与 at_hash（access_token 的 SHA-256 左半摘要），可用于校验令牌绑定关系。",
  "登录接口对同一账号连续失败 5 次将锁定 15 分钟，之后返回 HTTP 429 并带 Retry-After 头。",
  "同意页的跳过条件是「已存储的授权覆盖本次请求的全部 scope」。客户端一旦新增 scope，用户会重新看到同意页，因此不会在用户不知情时扩大授权范围。",
  "无论同意页是由用户点击「同意」通过的，还是因已有授权被自动跳过的，服务端都会签发授权码；回调地址始终携带 code 参数。",
]

export function buildAiDocJson(origin: string): AiDocJson {
  const issuer = getAppUrl()
  const discovery = buildDiscoveryDocument()
  return {
    name: "RUAN SSO",
    description:
      "RUAN 是一个基于 OIDC 的认证中心，提供授权码 + PKCE 流程。本文件为机器可读的接入说明。",
    issuer,
    discovery,
    endpoints: getEndpoints(),
    scopes: SCOPES,
    claims: discovery.claims_supported,
    grants: discovery.grant_types_supported,
    errors: ERRORS,
    limitations: LIMITATIONS,
    humanReadableUrl: `${origin}${PUBLIC_DOC_PATHS.human}`,
    machineReadableUrls: {
      text: `${origin}${PUBLIC_DOC_PATHS.text}`,
      json: `${origin}${PUBLIC_DOC_PATHS.json}`,
    },
    notes: NOTES,
  }
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`
  const sep = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n")
  return [head, sep, body].join("\n")
}

/** Plain-text, LLM-friendly view of the integration guide. */
export function buildAiDocText(origin: string): string {
  const issuer = getAppUrl()
  const discovery = buildDiscoveryDocument()
  const examples = getExamples()

  return `# RUAN SSO 接入说明书（机器可读版）

> 这是给 AI 助手 / 脚本读取的纯文本版本。人类可读版（需管理员登录）：${origin}${PUBLIC_DOC_PATHS.human}
> 结构化 JSON 版本：${origin}${PUBLIC_DOC_PATHS.json}

## 基本信息

- Issuer: ${issuer}
- Discovery: ${endpointUrl(issuer, "discovery")}
- JWKS: ${endpointUrl(issuer, "jwks")}
- 协议: OpenID Connect / OAuth 2.0 授权码 + PKCE(S256)
- 签名算法: RS256（非对称，公钥见 jwks_uri）
- 授权类型: ${discovery.grant_types_supported.join(", ")}

> 验签只需 JWKS 公钥，**不需要任何共享密钥**。切勿在客户端保存服务端签名私钥。

## 端点

${table(
  ["方法", "地址", "说明"],
  getEndpoints().map((e) => [e.method, e.path, e.summary])
)}

## OIDC 发现文档

直接访问 ${endpointUrl(issuer, "discovery")} 可获取以下元数据（此处为等价内容）：

\`\`\`json
${JSON.stringify(discovery, null, 2)}
\`\`\`

## 接入步骤

1. 在管理后台「应用」中注册应用，获得 client_id 与 client_secret（secret 仅创建时展示一次）。
2. 填写 Redirect URI，必须与客户端实际回调地址逐字符一致。
3. 选择组织范围：勾选「允许全部组织」或至少绑定一个组织（两者都没有会导致所有用户被拒绝）。
4. 生成 PKCE 参数并从浏览器跳转到授权端点。
5. 用户登录并确认授权后，浏览器带 code 回调到 redirect_uri。首次授权会展示同意页；用户此前已授权且本次 scope 未超出时会被自动跳过，无需再次确认。
6. 用 code 调用令牌端点换取 token，再调用 userinfo 获取用户信息。

> 用户可访问 ${origin}/account 查看并撤销已授权的应用；撤销后该应用下次登录会重新展示同意页。

### 1) 生成 PKCE 参数

\`\`\`bash
${examples.pkce}
\`\`\`

### 2) 跳转授权端点

\`\`\`
${examples.authorizeUrl}
\`\`\`

参数说明：

${table(
  ["参数", "必填", "说明"],
  [
    ["response_type", "是", "固定为 code"],
    ["client_id", "是", "应用注册后获得的 client_id"],
    ["redirect_uri", "是", "必须与注册值完全一致"],
    ["scope", "否", "默认 openid profile email，必须包含 openid"],
    ["state", "建议", "原样回传，用于防 CSRF"],
    ["nonce", "建议", "写入 id_token，用于防重放"],
    ["code_challenge", "是", "verifier 的 S256 摘要"],
    ["code_challenge_method", "是", "固定为 S256"],
  ]
)}

### 3) 用授权码换取令牌

\`\`\`bash
${examples.exchange}
\`\`\`

响应示例：

\`\`\`json
${examples.tokenResponse}
\`\`\`

### 4) 校验 id_token

\`\`\`ts
${examples.verify}
\`\`\`

### 5) 获取用户信息

\`\`\`bash
${examples.userinfo}
\`\`\`

\`\`\`json
${examples.userinfoResponse}
\`\`\`

### 6) 刷新令牌

刷新令牌会轮换：旧令牌在刷新成功后立即失效，必须保存响应中新的 refresh_token。

\`\`\`bash
${examples.refresh}
\`\`\`

### 7) 登出

\`\`\`bash
${examples.logout}
\`\`\`

## Scope 与 Claims

${table(
  ["Scope", "说明", "返回的 Claims"],
  SCOPES.map((s) => [s.name, s.description, s.claims.join(", ")])
)}

## 组织准入规则

用户必须属于该应用允许的组织才能完成授权：

- 应用勾选「允许全部组织」时，所有用户均可访问。
- 应用绑定指定组织时，用户须是其中任一 ACTIVE 组织的成员。
- 应用既未勾选全部组织、又未绑定任何组织时，**所有用户都会被拒绝**。

## 错误码

${table(
  ["错误码", "出现位置", "原因"],
  ERRORS.map((e) => [e.code, e.where, e.cause])
)}

## 已知限制

${LIMITATIONS.map((l) => `- ${l.replace(/\*\*/g, "")}`).join("\n")}

## 其他注意事项

${NOTES.map((n) => `- ${n}`).join("\n")}
`
}
