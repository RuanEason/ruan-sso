import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react"

import { CodeBlock } from "@/components/admin/docs/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ERRORS,
  LIMITATIONS,
  PUBLIC_DOC_PATHS,
  SCOPES,
  SECTIONS,
  getEndpoints,
  getExamples,
} from "@/lib/docs/oidc-docs"
import { getSessionUser } from "@/lib/auth/session"
import { buildDiscoveryDocument } from "@/lib/oidc/discovery"
import { getAppUrl } from "@/lib/env"

export const metadata: Metadata = {
  title: "接入文档 · RUAN SSO",
}

/**
 * Render per-request rather than prerendering the shell.
 *
 * The admin layout guards this route, but a fully static page would be
 * prerendered into the shared shell that streams before the layout's redirect
 * resolves — which would embed the docs markup in the response sent to
 * unauthenticated or non-admin visitors. Reading the session here makes the
 * page dynamic, so its content is only ever rendered for an authorized render.
 */
export const dynamic = "force-dynamic"

/** Wraps a section so the id, scroll offset and heading style stay consistent. */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">{children}</CardContent>
    </Card>
  )
}

function ParamTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: React.ReactNode[][]
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell
                  key={j}
                  className={j === 0 ? "font-mono text-xs align-top" : "align-top"}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default async function AdminDocsPage() {
  // Resolve the session in the page itself, not only in the admin layout. The
  // layout's redirect happens during a separate render pass, so a page that
  // renders regardless would have its markup embedded in the streamed shell.
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(PUBLIC_DOC_PATHS.human)}`)
  }
  if (user.role !== "ADMIN") {
    redirect("/login?error=forbidden")
  }

  const issuer = getAppUrl()
  const endpoints = getEndpoints()
  const examples = getExamples()
  const discovery = buildDiscoveryDocument()
  const toc = SECTIONS.filter((s) => s.id !== "overview")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">接入文档</h1>
          <p className="text-sm text-muted-foreground">
            RUAN SSO 的 OIDC 接入说明，供第三方应用开发者参考
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={PUBLIC_DOC_PATHS.text} target="_blank" rel="noreferrer" />
            }
          >
            <ExternalLinkIcon data-icon="inline-start" />
            AI 可读版 (.txt)
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={PUBLIC_DOC_PATHS.json} target="_blank" rel="noreferrer" />
            }
          >
            <ExternalLinkIcon data-icon="inline-start" />
            AI 可读版 (.json)
          </Button>
        </div>
      </div>

      <Alert>
        <AlertTriangleIcon />
        <AlertTitle>机器可读版本无需登录</AlertTitle>
        <AlertDescription>
          <code className="font-mono text-xs">{PUBLIC_DOC_PATHS.text}</code> 与{" "}
          <code className="font-mono text-xs">{PUBLIC_DOC_PATHS.json}</code>{" "}
          为公开地址，AI 助手或脚本可直接抓取，无需任何凭据。
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Section
            id="overview"
            title="概览与协议能力"
            description={`Issuer: ${issuer}`}
          >
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">OpenID Connect</Badge>
              <Badge variant="secondary">授权码 + PKCE</Badge>
              <Badge variant="outline">RS256</Badge>
              <Badge variant="outline">JWKS</Badge>
            </div>
            <p className="text-muted-foreground">
              RUAN 是一个精简的 OIDC 认证中心，只实现授权码流程（配合 PKCE）。
              客户端在浏览器中把用户引导到授权端点，用户登录并同意后，客户端用回调得到的
              授权码换取 token，再调用 userinfo 获取用户信息。
            </p>
            <Alert>
              <AlertDescription>
                token 使用 <strong>RS256 非对称签名</strong>，公钥通过{" "}
                <code className="font-mono text-xs">jwks_uri</code> 发布。
                客户端只需公钥即可验签，<strong>无需、也不应持有任何共享密钥</strong>。
              </AlertDescription>
            </Alert>
          </Section>

          <Section
            id="endpoints"
            title="端点一览"
            description="所有端点均以 Issuer 为前缀"
          >
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>方法</TableHead>
                    <TableHead>路径</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((e) => (
                    <TableRow key={e.path}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {e.method}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.path}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.summary}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section
            id="discovery"
            title="OIDC 发现"
            description="以下内容与 /.well-known/openid-configuration 实际返回值完全一致"
          >
            <p className="text-muted-foreground">
              大多数 OIDC 客户端库只需配置 Issuer 即可自动拉取端点。
              下面就是本服务当前会返回的完整元数据：
            </p>
            <CodeBlock
              title={endpoints[0]?.path ?? ""}
              code={JSON.stringify(discovery, null, 2)}
            />
            <CodeBlock title="命令行验证" code={examples.discoveryCurl} />
          </Section>

          <Section
            id="prepare"
            title="接入前准备"
            description="在管理后台「应用」页面完成注册"
          >
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
              <li>
                在本后台的{" "}
                <Link href="/admin/apps" className="underline underline-offset-4">
                  应用
                </Link>{" "}
                页面注册一个新的 OAuth Client，获得{" "}
                <code className="font-mono text-xs">client_id</code> 与{" "}
                <code className="font-mono text-xs">client_secret</code>。
              </li>
              <li>
                <span className="font-medium text-foreground">
                  client_secret 仅在创建时展示一次
                </span>
                ，请立即保存；若遗失只能重新创建应用。
              </li>
              <li>
                填写 Redirect URI。每个地址单独一行，必须与客户端实际回调地址
                <span className="font-medium text-foreground">逐字符完全一致</span>
                （含协议、端口、路径与结尾斜杠），不支持通配符。
              </li>
              <li>选择组织范围，见下方「组织准入规则」。</li>
              <li>
                确认 Scopes 至少包含 <code className="font-mono text-xs">openid</code>。
              </li>
              <li>若为纯前端/移动端等无法保管密钥的场景，注册时取消勾选「机密客户端」。</li>
            </ol>
          </Section>

          <Section
            id="pkce"
            title="授权码 + PKCE 流程"
            description="PKCE 是强制项，缺少 code_challenge 的请求会被直接拒绝"
          >
            <p className="font-medium">步骤 1 · 生成 PKCE 参数</p>
            <CodeBlock title="生成 code_verifier / code_challenge" code={examples.pkce} />

            <p className="font-medium">步骤 2 · 跳转授权端点</p>
            <p className="text-muted-foreground">
              把用户浏览器重定向到下面的地址（示例中尖括号部分需替换为真实值）：
            </p>
            <CodeBlock title="授权请求 URL" code={examples.authorizeUrl} />
            <ParamTable
              headers={["参数", "必填", "说明"]}
              rows={[
                ["response_type", "是", "固定为 code"],
                ["client_id", "是", "应用注册后获得的 client_id"],
                ["redirect_uri", "是", "必须与注册值完全一致"],
                ["scope", "否", "默认 openid profile email，必须包含 openid"],
                ["state", "建议", "原样回传，用于防 CSRF，务必校验"],
                ["nonce", "建议", "写入 id_token，用于防重放"],
                ["code_challenge", "是", "code_verifier 的 S256 摘要"],
                ["code_challenge_method", "是", "固定为 S256，不接受 plain"],
              ]}
            />

            <p className="font-medium">步骤 3 · 用户登录并同意</p>
            <p className="text-muted-foreground">
              未登录时会被引导到登录页，登录后进入同意页展示请求的权限范围。
              用户拒绝时回调会带 <code className="font-mono text-xs">error=access_denied</code>。
            </p>
            <p className="text-muted-foreground">
              首次授权一定会展示同意页。若用户此前已授权该应用，
              <span className="text-foreground">且本次请求的 scope 未超出已授权范围</span>
              ，则会自动跳过同意页，直接带 <code className="font-mono text-xs">code</code> 回调；
              一旦应用新增 scope，用户会重新看到同意页，不会在不知情时被扩大授权。
            </p>
            <p className="text-muted-foreground">
              用户可在 <code className="font-mono text-xs">/account</code>{" "}
              查看并撤销已授权的应用。撤销后，该应用下次登录会重新展示同意页。
            </p>

            <p className="font-medium">步骤 4 · 用授权码换取令牌</p>
            <p className="text-muted-foreground">
              授权码只能使用一次，有效期 10 分钟。机密客户端需带{" "}
              <code className="font-mono text-xs">client_secret</code>（表单参数或 HTTP Basic 均可）。
            </p>
            <CodeBlock title="换取 token" code={examples.exchange} />
            <CodeBlock title="响应" code={examples.tokenResponse} />

            <p className="font-medium">步骤 5 · 校验 id_token</p>
            <CodeBlock title="使用 jose 校验（RS256 + JWKS 公钥）" code={examples.verify} />

            <p className="font-medium">步骤 6 · 获取用户信息</p>
            <CodeBlock title="调用 userinfo" code={examples.userinfo} />
            <CodeBlock title="响应" code={examples.userinfoResponse} />
          </Section>

          <Section
            id="refresh"
            title="刷新令牌"
            description="刷新令牌会轮换，旧令牌立即失效"
          >
            <p className="text-muted-foreground">
              refresh_token 有效期 30 天；access_token 与 id_token 有效期均为 1 小时。
              每次刷新成功都会签发一个
              <span className="font-medium text-foreground">新的 refresh_token</span>
              ，同时吊销旧的。客户端必须持久化并使用最新的值，否则下次刷新会被拒绝。
            </p>
            <CodeBlock title="刷新令牌" code={examples.refresh} />
          </Section>

          <Section id="scopes" title="Scope 与 Claims">
            <ParamTable
              headers={["Scope", "说明", "返回的 Claims"]}
              rows={SCOPES.map((s) => [
                s.name,
                <span key={s.name} className="text-muted-foreground">
                  {s.description}
                </span>,
                <span key={`${s.name}-c`} className="font-mono text-xs">
                  {s.claims.join(", ")}
                </span>,
              ])}
            />
            <p className="text-muted-foreground">
              id_token 与 userinfo 的返回字段都会按申请的 scope 裁剪。
              未申请 <code className="font-mono text-xs">profile</code> 时不会返回{" "}
              <code className="font-mono text-xs">name</code>；
              未申请 <code className="font-mono text-xs">email</code> 时不会返回{" "}
              <code className="font-mono text-xs">email</code>。
              应用可用的 scope 上限由注册时填写的 allowedScopes 决定。
            </p>
          </Section>

          <Section
            id="organizations"
            title="组织准入规则"
            description="决定哪些用户可以使用某个应用"
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
              <li>应用勾选「允许全部组织」时，所有用户都可以访问。</li>
              <li>
                应用绑定指定组织时，用户必须属于其中任意一个状态为 ACTIVE 的组织。
              </li>
            </ul>
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>未绑定组织会导致所有人都无法访问</AlertTitle>
              <AlertDescription>
                如果应用既没有勾选「允许全部组织」，又没有绑定任何组织，
                那么<span className="font-medium">所有用户</span>都会在授权时被拒绝，
                回调返回 <code className="font-mono text-xs">access_denied</code>。
                这是最常见的接入失败原因，请先在「应用」页面确认组织范围。
              </AlertDescription>
            </Alert>
          </Section>

          <Section id="logout" title="登出">
            <p className="text-muted-foreground">
              把浏览器跳转到登出端点即可销毁当前的 SSO 会话，GET 与 POST 均支持。
              可选的 <code className="font-mono text-xs">post_logout_redirect_uri</code>{" "}
              指定登出后的回跳地址。
            </p>
            <CodeBlock title="登出请求" code={examples.logout} />
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>回跳地址不做白名单校验</AlertTitle>
              <AlertDescription>
                当前实现不会校验 <code className="font-mono text-xs">post_logout_redirect_uri</code>，
                任意地址都会被跳转。请勿把它当作可信跳转使用。
              </AlertDescription>
            </Alert>
          </Section>

          <Section
            id="errors"
            title="错误码与排查"
            description="授权端点通过回调 query 返回，令牌端点通过 JSON 返回"
          >
            <ParamTable
              headers={["错误码", "出现位置", "原因"]}
              rows={ERRORS.map((e) => [
                e.code,
                e.where,
                <span key={e.code} className="text-muted-foreground">
                  {e.cause}
                </span>,
              ])}
            />
            <div className="flex flex-col gap-2">
              <p className="font-medium">常见问题</p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">invalid_request</span>：
                  多半是 redirect_uri 与注册值不完全一致，或漏了 code_challenge。
                </li>
                <li>
                  <span className="font-medium text-foreground">invalid_grant</span>：
                  授权码已被使用过、超过 10 分钟，或 code_verifier 与 code_challenge 不匹配。
                </li>
                <li>
                  <span className="font-medium text-foreground">invalid_scope</span>：
                  请求了应用 allowedScopes 之外的 scope。
                </li>
                <li>
                  页面提示<span className="font-medium text-foreground">「无权访问此应用」</span>：
                  当前用户不在该应用允许的组织内，请管理员添加成员或调整组织绑定。
                </li>
              </ul>
            </div>
          </Section>

          <Section id="limits" title="已知限制">
            <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
              {LIMITATIONS.map((l) => (
                <li key={l}>
                  {l.split("**").map((part, i) =>
                    i % 2 === 1 ? (
                      <span key={i} className="font-medium text-foreground">
                        {part}
                      </span>
                    ) : (
                      part
                    )
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <nav className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-6 flex flex-col gap-1">
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              本页目录
            </p>
            {toc.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s.title}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
