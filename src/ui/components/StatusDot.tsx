import * as stylex from '@stylexjs/stylex'
import { color, motion, radius, size } from '../tokens.stylex'

export type DotState = 'ready' | 'connecting' | 'error' | 'idle'

/** One status colour mapping everywhere: green ready, pulsing amber connecting, red error, grey idle. */
export function StatusDot({ state }: { state: DotState }) {
  return <span aria-hidden {...stylex.props(styles.dot, styles[state])} />
}

const pulse = stylex.keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } })

const styles = stylex.create({
  dot: { display: 'inline-block', width: size.dot, height: size.dot, borderRadius: radius.pill, flexShrink: 0 },
  ready: { backgroundColor: color.signal },
  connecting: {
    backgroundColor: color.warn,
    animationName: pulse,
    animationDuration: motion.loop,
    animationIterationCount: 'infinite',
  },
  error: { backgroundColor: color.danger },
  idle: { backgroundColor: color.line },
})
