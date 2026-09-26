"use client"

import { Lottie } from "lottie-react"
import { cn } from "cn"

const ANIMATION_SRC = "/ruan-login-ani.json"

type RuanLoaderProps = {
  className?: string
  size?: number
  label?: string
} & React.ComponentProps<"span">

/** Inline brand loader (e.g. buttons). */
export function RuanLoader({
  className,
  size = 24,
  label = "加载中",
  ...props
}: RuanLoaderProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <Lottie
        src={ANIMATION_SRC}
        autoplay
        loop
        className="size-full"
      />
    </span>
  )
}

type RuanPageLoaderProps = {
  className?: string
  label?: string
  fullScreen?: boolean
}

/** Full-page / section brand loader. */
export function RuanPageLoader({
  className,
  label = "加载中…",
  fullScreen = true,
}: RuanPageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "flex flex-col items-center justify-center gap-3 bg-background",
        fullScreen ? "fixed inset-0 z-50" : "min-h-48 w-full py-10",
        className
      )}
    >
      <div className="size-36 md:size-44">
        <Lottie
          src={ANIMATION_SRC}
          autoplay
          loop
          className="size-full"
        />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
