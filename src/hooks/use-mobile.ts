import * as React from "react"

export const MOBILE_BREAKPOINT = 768

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const { isMobile } = useMobileBreakpoint()
  return isMobile
}

/** Distingue el primer render (aún no se midió el viewport) de escritorio vs móvil. */
export function useMobileBreakpoint() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return { isMobile: !!isMobile, ready: isMobile !== undefined }
}

export function useIsMobile() {
  const { isMobile } = useMobileBreakpoint()
  return isMobile
}

/** Distingue el primer render (aún no se midió el viewport) de escritorio vs móvil. */
export function useMobileBreakpoint() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return { isMobile: !!isMobile, ready: isMobile !== undefined }
}
