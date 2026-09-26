# 签名密钥管理

RUAN SSO 用 **RS256 非对称签名**签发 `id_token` / `access_token`。本文说明私钥放在哪、
为什么不用 HS256、例行轮换怎么做，以及私钥泄露时如何止血。

相关代码：`src/lib/auth/keys.ts`、`src/lib/env.ts`、`scripts/rotate-keys.mjs`、
`prisma/schema.prisma`（`SigningKey` 模型）。

---

## 1. 私钥放在哪

| 材料 | 位置 | 是否进仓库 / 镜像 |
|------|------|------------------|
| 私钥（PKCS#8 PEM） | 环境变量 `JWT_PRIVATE_KEY_PEM` | **否**，任何情况下都不 |
| 公钥（SPKI PEM） | 环境变量 `JWT_PUBLIC_KEY_PEM` | 否（可公开，但没必要入库） |
| 公钥（JWK） | `SigningKey` 表 + `/.well-known/jwks.json` | 公钥进库是设计的一部分 |

生产环境的私钥应**由部署时注入**（容器编排的 secret、KMS、或挂载的密钥文件转成环境变量），
不进仓库，也不进镜像层——镜像层里的任何文件对能拉取镜像的人都是可读的，而且会被缓存和分发。

仓库层面已经做了防护：`.gitignore` 忽略 `.env*`（保留 `.env.example`）与 `*.pem`。
`JWT_PRIVATE_KEY_PEM` 是**最高敏感度机密**：持有它即可伪造任意用户、任意应用的 token，
且因为 JWKS 只发布公钥，伪造出的 token 在接入方看来完全合法。

PEM 在 `.env` 里必须写成**单行 + `\n` 转义**（多行值在不同 shell / dotenv 实现间不可移植），
`src/lib/env.ts` 的 `readPem()` 负责还原。

---

## 2. 为什么是 RS256 而不是 HS256

HS256 是对称签名：签名和验签用**同一个**密钥。这意味着：

- 每一个需要验签的接入方都必须持有这个密钥；
- 于是**任何一个接入方都能伪造任意用户、任意其他应用的 token**——它能签出 RUAN 认可的一切；
- 密钥轮换变成全量协同操作：所有接入方必须同时换密钥，任何一方滞后都会中断；
- 一旦泄露，你无法只通过轮换来止血，因为攻击者手里那份密钥与你手上的是同一份。

RS256 下，接入方只持有**公钥**（通过 `/.well-known/jwks.json` 自动获取）：

- 接入方只能验签，不能签名，因此被攻陷的接入方无法影响其他任何一方；
- 轮换是服务端的单边操作，接入方通过 JWKS 自动跟随，无需协同；
- 泄露面收敛为一份私钥，且可以靠轮换来止血。

代价是 RS256 签名比 HS256 慢，对本项目的 token 量级（1 小时内有效的 access/id token）
可以忽略。

### `JWT_ALLOW_HS256` 的作用

`JWT_ALLOW_HS256` **默认关闭**，且**只用于存量接入方迁移**：某些老接入方仍在用共享的
`JWT_SECRET` 验 HS256 token，开关打开时 `verifyAccessToken()` 才额外接受 HS256
（见 `src/lib/auth/jwt.ts`）。

- 不要为了"兼容方便"长期开着它。开着它就等于保留了上面列出的全部 HS256 风险。
- 迁移完成后必须保持关闭。
- 轮换 RS256 密钥**不需要**动这个开关——两者无关。轮换时把它改开只会扩大攻击面。

---

## 3. 例行轮换流程

命令：

```bash
npm run keys:rotate                 # 真实轮换
npm run keys:rotate -- --dry-run    # 只显示将发生什么，不写数据库
```

脚本在**一个事务**里做两件事：

1. 把**新公钥**写入 `SigningKey`，`status = ACTIVE`；
2. 把**旧密钥**改为 `status = RETIRED`、`retiredAt = now()`。

**旧密钥绝对不会被删除。** access/id token 的有效期是 1 小时
（`ACCESS_TOKEN_TTL_SEC`），轮换瞬间删掉旧密钥会让所有已签发但未过期的 token 立即失效，
所有在线用户掉线。`buildJwks()` 会把 `RETIRED` 的密钥一并发布，所以新旧 token 在过渡期内
都能验签。

### 步骤

1. **先 dry-run**，确认将要退休的 kid 是你预期的那个：
   ```bash
   npm run keys:rotate -- --dry-run
   ```
2. **执行轮换**：
   ```bash
   npm run keys:rotate
   ```
   脚本会打印需要粘贴的 `JWT_PRIVATE_KEY_PEM` / `JWT_PUBLIC_KEY_PEM`（单行 `\n` 转义格式，
   与 `.env.example` 一致），以及旧 kid 和**建议最早清理时间**（`retiredAt + 1 小时`）。
3. **更新环境变量**。把打印出的两个值写入部署环境（生产用 secret 管理，不要写进仓库）。
4. **重启服务。这一步是强制的，不是可选的**

   > ⚠️ **重启陷阱**：Next.js 会把已经读过的环境变量缓存在进程内。服务器一旦读过旧密钥，
   > 即使 `.env` 已经变了，它仍会用旧密钥签名。结果是 `/.well-known/jwks.json` 发布的是一个
   > kid，而实际签发的 token 带的是另一个 kid——接入方会验签失败。
   >
   > 必须重启进程（不是热重载 `.env`）。

5. **核对重启后的状态**：jwks 必须**同时**包含新 kid 和退休的旧 kid。

   ```bash
   npm run keys:health
   ```

   体检会把「环境变量 / 注册表 / JWKS」三者逐个比对，有问题退出码为 1（详见第 6 节）。
   想看原始 JWKS 的话：

   ```bash
   curl -s $APP_URL/.well-known/jwks.json | grep -o '"kid":"[^"]*"'
   ```

   同时确认新签发的 token 里 `kid` 已经是新 kid。

6. **清理旧密钥**：在 `retiredAt + 1 小时` 之后，才能删除 `SigningKey` 表里 `status = RETIRED`
   的旧行。早于这个时间删除，等于让用旧密钥签发的、仍在有效期内的 token 全部失效。

   用脚本做，不要手写 SQL：

   ```bash
   npm run keys:prune              # 默认 dry-run，只报告哪些可删
   npm run keys:prune -- --apply   # 实际删除
   ```

   `keys:prune` 只会删除**同时满足**「`status = RETIRED`」且「`retiredAt + 1 小时` 已过」
   的行。`ACTIVE` 行在任何情况下都不会被删；尚未过宽限期的行会被跳过并打印可删时间。
   宽限期内的密钥是**正常状态**，轮换完立刻跑 prune 会看到 "NOTHING TO PRUNE"。

---

## 4. 私钥泄露应急流程

发现 `JWT_PRIVATE_KEY_PEM` 泄露（误提交、日志泄漏、主机被入侵、离职人员带走等）时，
**第一优先是停止攻击者继续伪造 token**，而不是先查清范围。

1. **立即轮换**（先做，不要等）：
   ```bash
   npm run keys:rotate
   ```
   轮换后新 token 全部由新密钥签发，攻击者手里的旧私钥不能再签出被认可的新 token。

2. **更新环境变量并重启**，按上一节的步骤 3–5 执行，并确认 JWKS 已包含新 kid。

3. **检查 `SigningKey` 表**，确认轮换状态符合预期：

   ```sql
   SELECT kid, alg, status, createdAt, retiredAt FROM SigningKey ORDER BY createdAt;
   ```

   期望：恰好一行 `ACTIVE`（新 kid），其余为 `RETIRED`。若有**任何非预期的 `ACTIVE` 行**，
   说明存在失控的密钥，必须立即退休。

   > 注意：轮换只能保护**将来**签发的 token，无法追溯撤销已经签发出去的 token。
   > 已泄露 token 会在剩余有效期内（最多 1 小时）继续被接入方接受。要缩短这个窗口，
   > 只能调小 `ACCESS_TOKEN_TTL_SEC` 并重启。

   应急场景**不要**急着 prune：泄露发生时，旧密钥可能仍在为合法用户的在途 token 服务。
   先等宽限期过去，再按上一节的步骤 6 清理。

4. **撤销受影响的 session**。Session 与签名密钥是两套独立的凭证：轮换签名密钥
   **不会**让已登录用户在 RUAN 门户内掉线（session 是数据库里的记录 + cookie，不依赖 JWT）。
   如果泄露范围可能包括 session，或用户密码可能已泄漏，需要主动撤销。

   目前 UI 只能撤销**当前管理员自己**的会话（`/admin` → 会话），接口为：

   ```
   GET    /api/admin/sessions   列出当前管理员的活跃会话
   DELETE /api/admin/sessions?id=<sessionId>
   ```

   批量撤销其他用户的 session 目前只能用 SQL（`Session` 表以 `tokenHash` 为唯一键，
   删除记录即失效）：

   ```sql
   -- 撤销某个用户的全部会话
   DELETE FROM Session WHERE userId = '<userId>';

   -- 或撤销某个时间点之前的全部会话（强制所有人重新登录）
   DELETE FROM Session WHERE createdAt < NOW();
   ```

5. **轮换其他可能同时泄露的凭证**：`SESSION_SECRET`、`JWT_SECRET`（若
   `JWT_ALLOW_HS256` 曾开启）、数据库密码、OAuth client secret。

6. **复盘并确认泄露渠道已封闭**（误提交要清历史并确认已从远端移除；日志要脱敏），
   否则轮换只是给攻击者增加一次重新获取的机会。

---

## 5. 验签用哪把密钥（`resolveVerifyKey`）

`src/lib/auth/keys.ts` 的 `resolveVerifyKey()` 按 token 头部**是否带 `kid`** 分两种情况，
这是刻意的，不要合并：

| token 的 `kid` | 行为 |
|----------------|------|
| **没有 `kid`** | 回落到环境变量 `JWT_PUBLIC_KEY_PEM` 验签。这类 token 早于 `kid` 机制，无从查表。 |
| **带了 `kid`** | **必须**在 `SigningKey` 表里查到该 `kid`，查不到就拒绝——即使它恰好等于当前配置的公钥。 |

为什么带 `kid` 时要强制查表：`SigningKey` 表是本部署**唯一**的"哪些密钥有权签发 token"的
权威记录。如果带着 `kid` 也能直接命中环境变量里的公钥，那么**换掉 `JWT_PUBLIC_KEY_PEM`
却没把新公钥登记进库**，会静默地让一把未登记的密钥投入使用——发布到 JWKS 的是一把密钥，
实际生效的是另一把，而没有任何地方会报错。

这条规则让上述漂移变成**验签失败**而不是静默通过。所以：

- 换密钥后如果没登记进库，带新 `kid` 的 token 会被拒绝（而不是被接受）；
- 正常情况下不需要关心：服务签发的 token 总是带 `kid`（见 `src/lib/auth/jwt.ts`），
  且 `keys:rotate` / `db:seed` 都会登记公钥。

> 清理旧密钥（`keys:prune`）之后，该 `kid` 的 token 会被拒绝。这是安全的——能被 prune 的
> 密钥，其签发过的 token 早已全部过期。

---

## 6. 健康体检与启动自检

上面第 3 节那个"重启陷阱"之所以危险，是因为漂移**在服务端是不可见的**：进程照常签发 token、
JWKS 照常返回 200，只有接入方在验签时才发现问题。为此有两道自动防线。

### 6.1 `npm run keys:health`（按需体检）

审计三样东西是否一致：**环境变量里的密钥**、**`SigningKey` 注册表**、**JWKS 实际发布的内容**。

```bash
npm run keys:health
```

有 `error` 级问题时退出码为 **1**，所以可以直接用作部署门禁或轮换后的 smoke test：

```bash
npm run keys:rotate && npm run keys:health   # 轮换后立即确认
```

| 检查项 | 级别 | 含义 |
|--------|------|------|
| `no-active-key` | error | 没有任何 `ACTIVE` 行，无从追溯签发者 |
| `multiple-active-keys` | error | 多于一行 `ACTIVE`，说明上次轮换没退休干净 |
| `env-key-not-registered` | error | 环境变量里的 kid 不是那个 `ACTIVE` kid —— **典型的漂移** |
| `active-key-not-published` | error | `ACTIVE` 密钥没出现在 JWKS 里，接入方无法验签 |
| `retired-key-not-published` | error | `RETIRED` 密钥仍在宽限期却不在 JWKS 里，在途 token 会验失败 |
| `stale-retired-keys` | warning | 有过了宽限期可清理的密钥，提示跑 `keys:prune` |

> `stale-retired-keys` 是 **warning** 而非 error：宽限期内的密钥本来就不该删，轮换完立刻体检
> 出现它是正常的。

### 6.2 启动自检（`src/instrumentation.ts`）

Next.js 的 `instrumentation.ts` 里导出 `register()`，会在**每个新服务实例启动时、开始处理请求
之前执行一次**。RUAN 在这里跑同一套审计逻辑，发现漂移就打印醒目告警：

```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
SIGNING KEY PROBLEM — 2 issue(s) detected at startup
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  [ERROR] env-key-not-registered
  ...
```

**它只打印日志，不会阻止启动。** 这是刻意的：密钥漂移会让验签退化，但登录和 session 仍然
正常，直接拒绝启动会把一个"警告"升级成"服务不可用"。运维看到告警后再决定处理方式。

> `register()` 在所有 runtime 都会被调用，而 Prisma 在 Edge runtime 不可用，所以自检用
> `NEXT_RUNTIME !== "nodejs"` 提前返回。整个自检也包在 try/catch 里——诊断代码绝不能反过来
> 把服务弄挂。

---

## 7. 相关命令速查

| 命令 | 用途 |
|------|------|
| `npm run keys:generate` | 生成全新密钥对（首次部署 / 无历史 token 时用） |
| `npm run keys:rotate -- --dry-run` | 预览轮换将做什么 |
| `npm run keys:rotate` | 执行轮换（登记新公钥 + 退休旧密钥，不删旧密钥） |
| `npm run keys:prune` | 预览哪些已过宽限期的 `RETIRED` 密钥可删（默认不删） |
| `npm run keys:prune -- --apply` | 实际删除已过宽限期的 `RETIRED` 密钥 |
| `npm run keys:health` | 审计环境 / 注册表 / JWKS 是否一致（有问题退出码 1） |
| `curl $APP_URL/.well-known/jwks.json` | 核对已发布的 kid 集合 |

> `keys:generate` 与 `keys:rotate` 的区别：前者**不碰数据库**，只打印一对新密钥，
> 适用于首次部署；后者会更新 `SigningKey` 表并保留旧公钥，是**已经在跑的服务**换密钥的
> 唯一正确方式。

> `keys:prune` 只删除**已经过了 `retiredAt + 1 小时`** 的 `RETIRED` 行，且默认是 dry-run。
> 删除前请确认：该密钥签发的所有 token 都已过期（1 小时足够），否则在线用户会掉线。
