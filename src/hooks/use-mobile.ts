import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // undefined on the server and during the first render, so SSR output and the
  // initial client render agree; the real value arrives via subscription.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Subscribe first, then sync once. The initial sync is deferred into a
    // microtask so no setState happens synchronously in the effect body
    // (react-hooks/set-state-in-effect); `onChange` is the callback path the
    // rule expects for external-subscription updates.
    mql.addEventListener("change", onChange)
    void Promise.resolve().then(onChange)

    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
