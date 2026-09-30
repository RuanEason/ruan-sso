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

已经上线的服务换密钥（轮换）用另一条命令，它会保留旧公钥以便存量 token 继续验签：

```bash
npm run keys:rotate -- --dry-run   # 先预览
npm run keys:rotate                # 实际执行
npm run keys:health                # 核对环境 / 注册表 / JWKS 是否一致
npm run keys:prune                 # 1 小时后：预览可清理的旧密钥
npm run keys:prune -- --apply      # 实际清理
```

服务启动时也会自动做一次一致性自检，发现漂移会在日志里打印醒目告警（不会阻止启动）。

详见 [`docs/key-management.md`](docs/key-management.md)。

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
npm run lint        # ESLint（要求 0 报错 0 警告）
npm test            # 单元测试（Vitest）
npx tsc --noEmit    # 类型检查
npm run build       # 生产构建
```

单元测试只覆盖纯逻辑（协议参数校验、PKCE、token 哈希、限流窗口、跳转地址白名单、
门户可见应用过滤），不依赖数据库、开发服务器或浏览器，因此可在毫秒级跑完，适合作为
每次提交的门禁。

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

> 修改这两个 PEM 后**必须重启进程**：Next.js 会把已读过的环境变量缓存在进程内，
> 只改文件不重启会让服务器继续用旧密钥签名，而 JWKS 公布的是新公钥。见
> [`docs/key-management.md`](docs/key-management.md)。

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
   - 首次授权会展示同意页；若此前已授权且本次 scope 未超出，则自动跳过同意页，同样带 `code` 回调
   - 用户可在 `/account` 撤销授权，撤销后下次登录会重新展示同意页
   - 用户直接访问 `/login`（不是从你的应用跳转过来）时，登录后进入应用门户 `/portal`，
     由用户自行选择要进入的应用；门户只发起授权请求，不改变上面的流程
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
- **审计日志**：登录、授权与管理员操作记录，可按事件类型与操作者过滤
- **接入文档**：第三方接入指南，含 AI 可读版本

## 审计日志

登录、授权与管理员操作都会写入 `AuditLog` 表，可在 `/admin/audit` 查看。

- 覆盖事件：登录成功/失败/被限流、登出、自助注册、同意/拒绝/撤销授权、签发与刷新令牌，以及全部管理员操作（用户、应用、组织、成员、会话）
- **不记录凭据**：密码、client_secret、授权码与各类 token 的取值都不会写入审计表
- **表结构不设外键**：删除用户时，记录“谁删除了他”的那一行不会被级联删除，因此删除行为事后仍可追溯
- 写入失败不会影响被审计的操作（例如审计表异常时登录仍可正常进行）

保留策略：**目前没有自动清理**，记录会一直保留，需要自行归档。

## 目录结构

```
src/app/
  login/                 # 登录门户（login-04 布局）
  portal/                # 应用门户：登录后的落点，列出用户有权访问的应用
  portal/launch/[clientId]  # 交由应用自身入口发起授权（不代发请求）
  consent/               # 授权同意
  account/               # 已授权的应用与撤销授权
  admin/                 # 管理后台
  oauth/                 # OIDC 协议路由
  api/auth/              # Session 登录 API
  api/account/           # 用户自助撤销授权 API
  api/admin/             # 后台管理 API（含 /api/admin/audit）
  .well-known/           # OIDC Discovery
src/components/login-form.tsx
src/components/portal-*.tsx
src/lib/auth/            # 密码、Session、JWT
src/lib/audit/           # 审计日志写入、查询与事件目录
src/lib/oidc/            # 校验、同意流程与 token 兑换
src/lib/portal.ts        # 门户可见应用过滤（与 userCanAccessClient 同一套规则）
src/lib/return-to.ts     # 登录落点与 returnTo 校验（零依赖，客户端/服务端共用）
prisma/                  # Schema / migrations / seed
docs/agent-context-backup.md   # AGENTS.md 可维护区的逐字备份（还原用，勿改）
scripts/restore-agent-context.mjs  # 从上述备份还原可维护区
```

### 登录落点

| 情形 | 落点 |
| --- | --- |
| 带 `returnTo`（从应用跳转而来） | 原样回到该地址，授权流程因此得以完成 |
| 无 `returnTo`，普通用户 | `/portal` |
| 无 `returnTo`，管理员 | `/admin` |
| `returnTo` 不安全（如 `//evil.com`） | 视为未提供，按角色分流 |

`returnTo` 校验只有一份实现（`src/lib/return-to.ts`），客户端登录表单与服务端共用，
不再有重复实现可以互相漂移。

### 应用门户 `/portal`

登录后没有落点（用户直接访问 `/login`）时，门户是该用户的落点：列出他有权访问的应用，
点击即开始授权。它**只做导航**。

- 可见性由 `visibleAppsForUser` 决定，与授权端点实际执行的 `userCanAccessClient`
  使用同一套规则（`allowAllOrganizations` 或绑定组织的成员），避免“门户里看得见、
  点进去被拒”。
- 点击应用后由 `/portal/launch/<client_id>` 把浏览器**交给应用自身的入口**，由应用发起
  自己的授权请求。门户**不构造授权请求、不生成 PKCE**：PKCE 的 `code_verifier` 必须留在
  换取令牌的一方，门户无法把它交给第三方应用的回调地址（早期实现试图这么做，被依赖方
  以 state 不匹配拒绝）。因此发码路径仍然只有一条，即
  `/oauth/authorize` → `approveAndIssueCode()`。
- 该路由的 `?next=` 仅接受与已注册回调地址**同源**的值，防止开放重定向。
- 用户没有任何可访问应用时，门户显示空状态并提示联系管理员。

## 给 AI 会话的项目背景（AGENTS.md）

`AGENTS.md` 里除 Next.js 自动写入的区块外，还有一个 **`project-context`（AI 可维护区）**，
内容是本项目的背景、架构约束、已知坑位与工作方式偏好。AI 会话会随上下文自动读取它
（`CLAUDE.md` 只是 `@AGENTS.md`，因此 Claude Code 同样生效）。

约定：

- 该区**鼓励 AI 会话修改、补充、批注**（发现错误就地更正，并追加
  `> 批注(YYYY-MM-DD, 依据): ...`），但**禁止整体删除**；确已过时就标注 `[已过时:原因]`。
- 上方 `nextjs-agent-rules` 区块由 `next dev` 自动维护，不要手改。
  `next dev` 只替换两个标记**之间**的内容，因此不会覆盖 `project-context`。
- 该区被写坏时可从逐字备份还原：

```bash
node scripts/restore-agent-context.mjs        # 还原
node scripts/restore-agent-context.mjs --dry  # 只看差异
```

备份文件为 `docs/agent-context-backup.md`（首次写入时的副本，勿改）。脚本只替换
`project-context` 两个标记之间的内容，不影响文件其余部分。
