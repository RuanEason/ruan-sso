"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "cn"

/**
 * Read-only code block with a copy button.
 *
 * `navigator.clipboard` is unavailable in non-secure contexts (e.g. plain http
 * on a LAN address), so fall back to selecting the text and telling the user to
 * copy manually rather than failing silently.
 */
export function CodeBlock({
  code,
  title,
  className,
}: {
  code: string
  title?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setFailed(false)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setFailed(true)
      setTimeout(() => setFailed(false), 3000)
    }
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-2 py-1">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {title ?? ""}
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => void copy()}
          aria-label="复制代码"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "已复制" : failed ? "请手动复制" : "复制"}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
