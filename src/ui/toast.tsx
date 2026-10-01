import * as stylex from '@stylexjs/stylex'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from './components/Button'
import { color, font, motion, radius, shadow, size, space } from './tokens.stylex'

export interface ToastData {
  text: string
  action?: { label: string; run: () => void }
}

interface ToastApi {
  show: (t: ToastData) => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })
export const useToast = () => useContext(ToastContext)

const VISIBLE_MS = 6000

/** One toast at a time; a new one replaces the current. Pauses while hovered or focused. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData & { id: number }>()
  const [leaving, setLeaving] = useState(false)
  const paused = useRef(false)
  const seq = useRef(0)

  const show = useCallback((t: ToastData) => {
    setLeaving(false)
    setToast({ ...t, id: ++seq.current })
  }, [])
  const api = useMemo(() => ({ show }), [show])

  useEffect(() => {
    if (!toast) return
    let remaining = VISIBLE_MS
    const tick = setInterval(() => {
      if (paused.current) return
      remaining -= 250
      if (remaining <= 0) setLeaving(true)
    }, 250)
    return () => clearInterval(tick)
  }, [toast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          role="status"
          onMouseEnter={() => (paused.current = true)}
          onMouseLeave={() => (paused.current = false)}
          onFocus={() => (paused.current = true)}
          onBlur={() => (paused.current = false)}
          onAnimationEnd={() => leaving && (setToast(undefined), setLeaving(false))}
          {...stylex.props(styles.toast, leaving && styles.leaving)}
        >
          <span>{toast.text}</span>
          {toast.action && (
            <Button
              variant="quiet"
              onClick={() => {
                toast.action!.run()
                setLeaving(true)
              }}
            >
              {toast.action.label}
            </Button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}

const enter = stylex.keyframes({ from: { opacity: 0, transform: 'translate(-50%, -8px)' }, to: { opacity: 1, transform: 'translate(-50%, 0)' } })
const exit = stylex.keyframes({ from: { opacity: 1, transform: 'translate(-50%, 0)' }, to: { opacity: 0, transform: 'translate(-50%, -8px)' } })

const styles = stylex.create({
  toast: {
    position: 'fixed',
    // below the header, so it never covers the composer or Send
    top: `calc(${size.header} + ${space.sm})`,
    left: '50%',
    transform: 'translate(-50%, 0)',
    zIndex: 30,
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    maxWidth: `calc(100vw - 2 * ${space.lg})`,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.xs,
    paddingBlock: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.ink,
    color: color.bg,
    fontFamily: font.ui,
    fontSize: font.sm,
    boxShadow: shadow.toast,
    animationName: enter,
    animationDuration: motion.base,
    animationTimingFunction: motion.ease,
  },
  leaving: { animationName: exit, animationFillMode: 'forwards' },
})
