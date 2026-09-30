import * as stylex from '@stylexjs/stylex'
import { useEffect } from 'react'
import { color, font, radius, space } from '../tokens.stylex'
import { Button } from './Button'

export interface ToastData {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export function Toast({ toast, onDone }: { toast: ToastData; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000)
    return () => clearTimeout(t)
  }, [toast.id, onDone])
  return (
    <div role="status" {...stylex.props(styles.toast)}>
      <span>{toast.text}</span>
      {toast.action && (
        <Button
          variant="quiet"
          onClick={() => {
            toast.action!.run()
            onDone()
          }}
        >
          {toast.action.label}
        </Button>
      )}
    </div>
  )
}

const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translate(-50%, 8px)' }, to: { opacity: 1, transform: 'translate(-50%, 0)' } })

const styles = stylex.create({
  toast: {
    position: 'fixed',
    bottom: space.xl,
    left: '50%',
    transform: 'translate(-50%, 0)',
    zIndex: 30,
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.xs,
    paddingBlock: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.ink,
    color: color.bg,
    fontFamily: font.ui,
    fontSize: font.sm,
    boxShadow: '0 10px 30px rgba(15, 25, 40, 0.25)',
    animationName: rise,
    animationDuration: '200ms',
  },
})
