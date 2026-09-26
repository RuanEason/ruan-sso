"use client"

import { useEffect, useRef } from "react"
import { cn } from "cn"

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

type Props = {
  className?: string
  particleCount?: number
  linkDistance?: number
}

export function NetworkParticles({
  className,
  particleCount = 72,
  linkDistance = 120,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let particles: Particle[] = []

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = parent.clientWidth
      height = parent.clientHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.max(
        28,
        Math.round(particleCount * Math.min(1, (width * height) / 280_000))
      )
      particles = Array.from({ length: count }, () => createParticle(width, height))
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = e.clientX - rect.left
      mouseRef.current.y = e.clientY - rect.top
      mouseRef.current.active = true
    }

    const onPointerLeave = () => {
      mouseRef.current.active = false
      mouseRef.current.x = -9999
      mouseRef.current.y = -9999
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      // soft vignette atmosphere
      const bg = ctx.createRadialGradient(
        width * 0.45,
        height * 0.35,
        0,
        width * 0.5,
        height * 0.55,
        Math.max(width, height) * 0.75
      )
      bg.addColorStop(0, "rgba(90, 120, 180, 0.18)")
      bg.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)

      const mouse = mouseRef.current
      const maxDist = linkDistance
      const maxDist2 = maxDist * maxDist

      for (const p of particles) {
        if (!reducedMotion) {
          p.x += p.vx
          p.y += p.vy

          if (p.x < 0 || p.x > width) p.vx *= -1
          if (p.y < 0 || p.y > height) p.vy *= -1
          p.x = Math.max(0, Math.min(width, p.x))
          p.y = Math.max(0, Math.min(height, p.y))

          if (mouse.active) {
            const dx = p.x - mouse.x
            const dy = p.y - mouse.y
            const dist2 = dx * dx + dy * dy
            const influence = 140
            if (dist2 < influence * influence && dist2 > 0.01) {
              const dist = Math.sqrt(dist2)
              const force = (1 - dist / influence) * 0.045
              p.vx += (dx / dist) * force
              p.vy += (dy / dist) * force
            }
          }

          // gentle damping so mouse push settles
          p.vx *= 0.992
          p.vy *= 0.992
          const speed = Math.hypot(p.vx, p.vy)
          const minSpeed = 0.12
          const maxSpeed = 0.55
          if (speed < minSpeed) {
            const scale = minSpeed / (speed || 1)
            p.vx *= scale
            p.vy *= scale
          } else if (speed > maxSpeed) {
            const scale = maxSpeed / speed
            p.vx *= scale
            p.vy *= scale
          }
        }
      }

      // links
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist2 = dx * dx + dy * dy
          if (dist2 > maxDist2) continue
          const dist = Math.sqrt(dist2)
          let alpha = 1 - dist / maxDist

          if (mouse.active) {
            const mx = (a.x + b.x) / 2 - mouse.x
            const my = (a.y + b.y) / 2 - mouse.y
            const mdist = Math.hypot(mx, my)
            if (mdist < 160) {
              alpha += (1 - mdist / 160) * 0.55
            }
          }

          ctx.strokeStyle = `rgba(210, 225, 255, ${Math.min(0.55, alpha * 0.35)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }

        // mouse tether
        if (mouse.active) {
          const dx = a.x - mouse.x
          const dy = a.y - mouse.y
          const dist2 = dx * dx + dy * dy
          const tether = 170
          if (dist2 < tether * tether) {
            const dist = Math.sqrt(dist2)
            const alpha = 1 - dist / tether
            ctx.strokeStyle = `rgba(160, 200, 255, ${alpha * 0.45})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(mouse.x, mouse.y)
            ctx.stroke()
          }
        }
      }

      // nodes
      for (const p of particles) {
        let glow = 0
        if (mouse.active) {
          const dist = Math.hypot(p.x - mouse.x, p.y - mouse.y)
          if (dist < 140) glow = 1 - dist / 140
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r + glow * 1.4, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(230, 240, 255, ${0.55 + glow * 0.4})`
        ctx.fill()
      }

      // mouse node
      if (mouse.active) {
        ctx.beginPath()
        ctx.arc(mouse.x, mouse.y, 2.4, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }

    resize()
    draw()

    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerleave", onPointerLeave)
    canvas.addEventListener("pointerdown", onPointerMove)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerleave", onPointerLeave)
      canvas.removeEventListener("pointerdown", onPointerMove)
    }
  }, [particleCount, linkDistance])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("absolute inset-0 size-full touch-none", className)}
    />
  )
}

function createParticle(width: number, height: number): Particle {
  const angle = Math.random() * Math.PI * 2
  const speed = 0.15 + Math.random() * 0.25
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 1.2 + Math.random() * 1.4,
  }
}
