import * as stylex from '@stylexjs/stylex'
import type { Availability } from '../../core/ai/capabilities'
import type { ContextStats } from '../../core/ai/sessionCache'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'

interface Props {
  title: string
  model: Availability
  progress?: number
  stats?: ContextStats
  showMenu: boolean
  onMenu: () => void
  onSettings: () => void
}

const STATUS: Record<Availability, string> = {
  available: 'The on-device model is ready. Everything runs on this device.',
  downloading: 'The on-device model is downloading.',
  downloadable: 'The on-device model needs to be downloaded before you can chat.',
  unavailable: 'Chrome’s built-in model is not available on this device.',
}

export function Header({ title, model, progress, stats, showMenu, onMenu, onSettings }: Props) {
  const pct = stats && stats.window ? Math.min(100, Math.round((stats.usage / stats.window) * 100)) : 0
  const statusText =
    model === 'downloading' && progress != null ? `${STATUS.downloading} ${Math.round(progress * 100)}%` : STATUS[model]
  return (
    <header {...stylex.props(styles.header)}>
      {showMenu && <Button icon="menu" label="Show chats" onClick={onMenu} />}
      <h1 {...stylex.props(styles.title)}>{title}</h1>
      {stats && (
        <span
          role="meter"
          aria-label="Context used"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          title={`Model memory ${pct}% used (${stats.usage.toLocaleString()} of ${stats.window.toLocaleString()} tokens)`}
          {...stylex.props(styles.meter)}
        >
          <span {...stylex.props(styles.meterFill(pct), pct > 80 && styles.meterHot)} />
        </span>
      )}
      <span role="img" aria-label={statusText} title={statusText} {...stylex.props(styles.chip)}>
        <span {...stylex.props(styles.dot, styles[model], model === 'downloading' && styles.ring(progress ?? 0))} />
        <span {...stylex.props(styles.chipLabel)}>On-device</span>
      </span>
      <Button icon="settings" label="Settings" onClick={onSettings} />
    </header>
  )
}

const spin = stylex.keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } })

const styles = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    height: size.header,
    flexShrink: 0,
    paddingInline: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.line,
    fontFamily: font.ui,
  },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontSize: font.md,
    fontWeight: 600,
    color: color.ink,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meter: {
    position: 'relative',
    width: '44px',
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.sunken,
    overflow: 'hidden',
  },
  meterFill: (pct: number) => ({
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    width: `${pct}%`,
    backgroundColor: color.accent,
    transitionProperty: 'width',
    transitionDuration: motion.slow,
  }),
  meterHot: { backgroundColor: color.warn },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    height: '26px',
    paddingInline: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.surface,
    cursor: 'default',
  },
  chipLabel: { fontSize: font.xs, fontWeight: 600, color: color.muted, letterSpacing: '0.02em' },
  dot: { position: 'relative', width: '10px', height: '10px', borderRadius: radius.pill },
  available: { backgroundColor: color.signal, boxShadow: `0 0 0 3px color-mix(in srgb, ${color.signal} 22%, transparent)` },
  downloadable: { backgroundColor: color.warn },
  unavailable: { backgroundColor: color.danger },
  downloading: {
    backgroundColor: 'transparent',
    animationName: spin,
    animationDuration: '1.6s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  ring: (p: number) => ({
    backgroundImage: `conic-gradient(${color.accent} ${Math.max(0.08, p) * 360}deg, ${color.sunken} 0)`,
  }),
})
