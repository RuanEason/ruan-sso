<!-- BEGIN:project-context — AI 可维护区                                  -->
<!--                                                                    -->
<!-- 维护约定（重要，请先读完再改）：                                      -->
<!--   1. 本区内容由 AI 会话共同维护，鼓励修正错误、补充坑位、写得更准。    -->
<!--   2. 只允许「修改 / 追加 / 批注」，禁止整体删除本区。                 -->
<!--      即使认为某段过时，也请改为标注 [已过时:原因] 而不是删掉。         -->
<!--   3. 发现错误就地更正，并在该条后追加批注：                           -->
<!--      > 批注(YYYY-MM-DD, 依据): 原描述 X 有误，实际为 Y。              -->
<!--   4. 不要改动上方 nextjs-agent-rules 区块，那是 next dev 自动写入的。  -->
<!--   5. 本区被写坏时，从原始备份还原（备份是首次写入时的逐字副本，勿改）：    -->
<!--      node scripts/restore-agent-context.mjs        # 还原                       -->
<!--      node scripts/restore-agent-context.mjs --dry  # 只看差异，不写入            -->
<!--      备份文件：docs/agent-context-backup.md                                     -->
<!--      脚本只替换本区（project-context 两标记之间），不碰上方 nextjs 区块。        -->
<!--                                                                    -->
<!-- 事实核对基准：HEAD 9a28046（2026-09-26）。                             -->
<!-- 若你推了新提交，请顺手更新下方「当前状态」一节的 HEAD 与测试数。        -->
<!-- =================================================================== -->

# RUAN SSO — 项目背景

## 项目位置与运行环境

- 本地路径：`E:\zygsso`（Windows + PowerShell）
- 技术栈：**Next.js 16.3.6**（App Router）+ React 19 + Prisma 6 + MySQL + Tailwind v4 + shadcn/ui + Vitest 5
- 仓库：https://github.com/RuanEason/ruan-sso ，分支 `main`

## 这是什么

一个精简的 OIDC 统一身份认证中心（SSO），自身也是 Next.js 应用。核心能力：

- **协议端点**：`/oauth/authorize`、`/oauth/token`、`/oauth/userinfo`、`/oauth/logout`、
  `/.well-known/openid-configuration`、`/.well-known/jwks.json`
- **只有授权码 + PKCE（S256 强制）** 一种流程；不支持 implicit / client_credentials / device_code
- **RS256 签名**，私钥只在 `.env`（已 gitignore），依赖方用 JWKS 公钥验签，不需要共享密钥
- **组织（Organization）约束**「谁能登录哪些应用」：应用可勾选「允许全部组织」或绑定若干组织
- **同意页**：仅在「从未授权」或「本次 scope 超出已授权范围」时展示，已覆盖的重复授权会被静默跳过
- **审计日志**：append-only，写入收口在 `recordAudit`，**绝不记录任何凭据**（密码/令牌/授权码/client_secret）
- **应用门户 `/portal`**：用户无落点时的落点，列出其有权访问的应用
- **管理后台 `/admin`**：组织 / 用户 / 应用 / 会话 / 审计日志 / 接入文档
- **接入文档三视图**：`/admin/docs`（人看，需登录）、`/admin/docs.txt`、`/admin/docs.json`（机器读，公开）

## 当前状态（HEAD `9a28046`）

- 工作树干净，CI 全绿
- `npm test` → **151 passed（15 个文件）**，全部是纯逻辑单测，不依赖 DB / dev server / 浏览器
- 质量门禁四项，缺一不可：

```powershell
npm run lint        # 要求 0 报错 0 警告
npm test            # Vitest
npx tsc --noEmit    # 类型检查
npm run build       # prisma generate && next build
```

## 关键架构约束（改代码前务必理解）

1. **发码路径只有一条**：所有授权必须走 `src/lib/oidc/consent-flow.ts` 的
   `approveAndIssueCode()`。同意页的「同意」和 authorize 端点的「跳过同意」都汇入它。
   **绝不新写第二条发码路径**——曾经绕过它，导致「跳过了同意页但 app 拿不到 token」。
2. **权限判断只有一套规则**：`src/lib/org/access.ts` 的 `userCanAccessClient()`。
   门户/列表类功能必须复用它（或与它严格同构的纯函数 + 一致性测试），
   否则会出现「列表里看得见、点进去被拒」。
3. **登录落点在 `src/lib/return-to.ts`**（零依赖纯模块，客户端与服务端共用）：
   - 有安全 `returnTo` → 原样用它（**从应用跳来的授权链路，绝对不要动**）
   - 无 `returnTo`：管理员 → `/admin`，普通用户 → `/portal`
   - `returnTo` 不安全（`//evil.com`、`/\evil.com`）→ 视为未提供，按角色分流
4. **`isSafeReturnTo` 只有一份实现**（在 `return-to.ts`）。历史上它有两份并被注释声称
   「保持一致」，已合并。**不要再复制一份到客户端**。
   注意：`src/lib/oidc/validate.ts` **不能**被客户端或 Edge 引用——它 import `@/lib/env`，
   那条链通向服务端密钥配置。
5. **门户只做导航**：`/portal/launch/<clientId>` 把浏览器**交给应用自身的入口**，由应用发起
   自己的授权请求。门户**不生成 PKCE、不构造授权请求**——`code_verifier` 必须留在换取令牌的
   一方，门户无法交给第三方回调（试过，被依赖方以 state 不匹配拒绝，且会落到 `/callback` 拿 404）。
6. **门户卡片必须用普通 `<a>`，不能用 `next/link`**：`/portal/launch/*` 会重定向到跨域的应用源站，
   用 Link 会被 App Router 拦截并预取 RSC，撞 CORS。

## 路由一览

```
/login                      登录页（"use client" 表单在 src/components/login-form.tsx）
/portal                     应用门户（登录后的落点）
/portal/launch/[clientId]   交由应用自身入口发起授权
/consent                    授权同意
/account                    已授权的应用与撤销（入口在门户右上角菜单）
/register                   公开组织自助注册
/admin/*                    管理后台（layout 做权威鉴权）
/oauth/authorize|token|userinfo|logout
/.well-known/openid-configuration | jwks.json
/api/auth/login|logout|me|register
/api/account/consents
/api/admin/{users,apps,organizations,sessions,audit}
/admin/docs | /admin/docs.txt | /admin/docs.json
```

`src/middleware.ts` 只做**乐观预检**（cookie 是否存在），**权威鉴权在 `src/app/admin/layout.tsx`**。
middleware 跑 Edge runtime，**不得 import Prisma 相关模块**。

## 已知的坑（踩过，务必避免）

1. **不要用 shell 正则批量改源码**（曾损坏文件）。一律用精确的 edit 操作。
2. **PowerShell 会拆坏提交信息里的引号**：把消息写进文件再用 `git commit -F`，提交后删掉该文件。
   提交信息用英文，`feat:` / `fix:` 前缀。
3. **dev server 会锁 Prisma 的 DLL**，导致 `prisma generate` / `npm run build` 报
   `EPERM ... query_engine-windows.dll.node`。先停 dev server：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -match 'dev' -and $_.CommandLine -notmatch 'dsh-subprocess' }
```

   确认是真正的 Next 进程再 `Stop-Process`。**别用会匹配到自身 shell 的过滤条件。**
4. **`redirect()` 在 `app/loading.tsx` 存在时是流式客户端重定向**：SSR 会先吐 HTML 外壳（HTTP 200）+
   HTML 内嵌 `NEXT_REDIRECT`，**不是 3xx**。用 `Invoke-WebRequest -MaximumRedirection 0` 断言跳转会误判，
   要在真实浏览器里断言。
5. **远程 MySQL（`192.168.10.50:3306`）偶发 `P1001`**，会让 `/oauth/userinfo` 返回 500。
   遇到先看服务端日志再怀疑自己的改动。
6. **不要提交** `demo-client/` 和 `scripts/verify-*.mjs`（已 gitignore）。
   **不要提交任何真实密钥**（私钥只在 `.env`）。

## 测试与验证约定

- 单测放 `tests/*.test.ts`，**只测纯逻辑**（不依赖 DB / 浏览器），这样能进 CI 且零 flaky。
  数据库交互用 `vi.mock("@/lib/db")` 挡掉，见 `tests/consent-flow.test.ts`、`tests/portal-apps.test.ts`。
- **UI 层没有 e2e 进 CI**。需要真实浏览器验证时，在 `scripts/verify-*.mjs`（gitignore）里用
  `playwright-core` 驱动本机 Edge：
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
- 端到端联调：`demo-client/server.mjs` 是一个**真的第三方依赖方**（跑在 :4000），
  会做 PKCE、换 token、用 JWKS 验签 id_token、调 userinfo，并把每步结果写进
  `demo-client/result.json`。**这是验证 SSO 功能是否真的可用的最有力手段**。
  注意该文件是追加写的，断言时要按本次运行的 `sub` 过滤，否则会读到历史运行的记录。
- 本地 DB 里有一些历史测试用户；`prisma/seed.ts` 只创建 `admin` / `admin123`。

## push 后确认 CI

```powershell
Invoke-RestMethod -Uri "https://api.github.com/repos/RuanEason/ruan-sso/actions/runs?per_page=1" `
  -Headers @{ "User-Agent" = "dsh" }
```

CI 流程：install → lint → test → build，**不需要 secrets**。
`git push` 会用 stderr 输出进度，PowerShell 会把成功也显示成 `[exit code: 1]`——看实际输出行确认。

## 交流与工作方式偏好

- **中文交流**
- **先讲清楚问题和方案再动手**，不要闷头做；有歧义先问
- **重视诚实**：没验证过的、或判断被推翻的，直接说，不要含糊。
  说「PASS」之前要真的跑过；被自己的验证推翻时，明确讲出来并说明原因。
- 改动要**端到端验证**，不要只靠单测就宣称功能可用
- 注释写**为什么**（尤其是「为什么不能那样做」），不要把代码翻译成中文

<!-- END:project-context — AI 可维护区 -->
