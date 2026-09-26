# RUAN SSO

RUAN 是一个基于 Next.js + Prisma + MySQL 的精简 OIDC 认证中心，提供登录门户、管理后台，以及授权码 + PKCE 协议端点。

## 技术栈

- Next.js App Router (TypeScript)
- Prisma + MySQL
- shadcn/ui（登录页基于 `login-04`）
- jose (JWT RS256 + JWKS)
- bcryptjs

## 快速开始

### 1. 配置 MySQL

在本地/内网 MySQL 上创建独立库（勿复用其他业务库）：

```sql
CREATE DATABASE IF NOT EXISTS ruan_sso
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

复制环境变量并填写连接串：

```bash
cp .env.example .env
```

示例：

```
DATABASE_URL="mysql://root:PASSWORD@192.168.10.50:3306/ruan_sso"
APP_URL="http://localhost:3000"
SESSION_SECRET="..."
```

### 2. 生成签名密钥

SSO 使用 **RS256 非对称签名**：私钥只留在服务端，公钥通过 `/.well-known/jwks.json`
发布，接入方仅凭公钥验签，**不需要任何共享密钥**。

```bash
npm run keys:generate
```

把输出粘贴到 `.env` 的 `JWT_PRIVATE_KEY_PEM` / `JWT_PUBLIC_KEY_PEM`。

> `JWT_PRIVATE_KEY_PEM` 是最高敏感度机密：持有它即可伪造任意用户、任意应用的 token。
> 切勿提交到仓库，切勿分发给接入方。

### 3. 安装与初始化

```bash
npm install
npx prisma migrate deploy
npm run db:seed
```

### 4. 启动开发服务

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

### 5. 质量校验

```bash
npm run lint     # ESLint
npm test         # 单元测试（Vitest）
npm run build    # 生产构建
```

单元测试只覆盖纯逻辑（协议参数校验、PKCE、token 哈希、限流窗口、跳转地址白名单），
不依赖数据库、开发服务器或浏览器，因此可在毫秒级跑完，适合作为每次提交的门禁。

## 组织（Organization）

RUAN 用组织约束「谁能登录哪些应用」：

| 类型 | 说明 |
|------|------|
| `ENTERPRISE` | 企业组织，成员由管理员添加 |
| `GROUP` | 团体组织，成员由管理员添加 |
| `PUBLIC` | 公开组织，可自助注册（`/register`） |

- 用户可加入多个组织
- 应用可绑定「全部组织」或若干指定组织
- 授权时：用户须属于该应用允许的组织，否则拒绝

种子数据自带：`enterprise` / `circle` / `public` 三个组织；Demo App 默认允许全部组织。

## 默认账号


| 类型 | 值 |
|------|-----|
| 管理员 | `admin` / `admin123` |
| Demo Client ID | `ruan-demo-app` |
| Demo Client Secret | `demo-client-secret` |
| Redirect URI | `http://localhost:4000/callback` |

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | MySQL 连接串（仅指向 `ruan_sso` 库） |
| `APP_URL` | Issuer 与回调基址，如 `http://localhost:3000` |
| `SESSION_SECRET` | Session 密钥（≥16 字符） |
| `JWT_PRIVATE_KEY_PEM` | RS256 私钥（PKCS#8 PEM，单行 `\n` 转义）。**最高机密** |
| `JWT_PUBLIC_KEY_PEM` | RS256 公钥（SPKI PEM），经 JWKS 对外发布 |
| `JWT_ALLOW_HS256` | 过渡开关：是否仍接受 HS256 存量 token。默认 `false` |
| `JWT_SECRET` | 仅在 `JWT_ALLOW_HS256=true` 时用于校验存量 HS256 token |

## OIDC 端点

| 端点 | 路径 |
|------|------|
| Discovery | `GET /.well-known/openid-configuration` |
| JWKS | `GET /.well-known/jwks.json` |
| Authorize | `GET /oauth/authorize` |
| Token | `POST /oauth/token` |
| UserInfo | `GET /oauth/userinfo` |
| Logout | `GET/POST /oauth/logout` |

> token 使用 **RS256** 签名，公钥由 `jwks_uri` 发布。客户端用公钥验签即可，
> 既不需要也不应持有任何共享密钥。`JWT_ALLOW_HS256` 仅用于存量 HS256 接入方的
> 过渡期，默认关闭，迁移完成后应保持关闭。

## 接入文档

登录管理员后访问 `/admin/docs` 查看接入文档（端点、PKCE 流程、Scope、错误码与已知限制）。

面向 AI 助手 / 脚本的机器可读版本**无需登录**即可访问：

| 版本 | 地址 | 说明 |
|------|------|------|
| 人类可读 | `/admin/docs` | 需管理员登录 |
| 纯文本 | `/admin/docs.txt` | 公开，适合直接喂给 LLM |
| 结构化 | `/admin/docs.json` | 公开，适合脚本解析 |

三种版本由同一份数据源（`src/lib/docs/oidc-docs.ts`）生成，且其中的 OIDC 发现元数据
直接复用 `/.well-known/openid-configuration` 的构造函数，因此文档不会与实际行为不一致。

## PKCE 联调示例

1. 生成 `code_verifier` 与 `code_challenge`（S256）
2. 浏览器打开：

```
http://localhost:3000/oauth/authorize?response_type=code&client_id=ruan-demo-app&redirect_uri=http://localhost:4000/callback&scope=openid%20profile%20email&state=xyz&code_challenge=<CHALLENGE>&code_challenge_method=S256
```

3. 登录并同意授权后，回调拿到 `code`
4. 兑换 token：

```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=<CODE>" \
  -d "redirect_uri=http://localhost:4000/callback" \
  -d "client_id=ruan-demo-app" \
  -d "client_secret=demo-client-secret" \
  -d "code_verifier=<VERIFIER>"
```

5. 调用 UserInfo：

```bash
curl http://localhost:3000/oauth/userinfo \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

6. 用 JWKS 公钥验签 `id_token`（**无需任何共享密钥**）：

```bash
curl http://localhost:3000/.well-known/jwks.json
```

```js
import { createRemoteJWKSet, jwtVerify } from "jose"

const JWKS = createRemoteJWKSet(
  new URL("http://localhost:3000/.well-known/jwks.json")
)
const { payload } = await jwtVerify(idToken, JWKS, {
  issuer: "http://localhost:3000",
  audience: "ruan-demo-app",
  algorithms: ["RS256"],
})
if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch")
```

## 管理后台

登录管理员后访问 `/admin`：

- **概览**：用户 / 应用 / 会话统计
- **用户**：创建、编辑、启用/禁用、重置密码
- **应用**：注册 OAuth Client（secret 仅创建时展示一次）
- **会话**：查看并撤销当前管理员会话
- **接入文档**：第三方接入指南，含 AI 可读版本

## 目录结构

```
src/app/
  login/                 # 登录门户（login-04 布局）
  consent/               # 授权同意
  admin/                 # 管理后台
  oauth/                 # OIDC 协议路由
  api/auth/              # Session 登录 API
  api/admin/             # 后台管理 API
  .well-known/           # OIDC Discovery
src/components/login-form.tsx
src/lib/auth/            # 密码、Session、JWT
src/lib/oidc/            # 校验与 token 兑换
prisma/                  # Schema / migrations / seed
```
