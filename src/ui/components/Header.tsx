import * as stylex from '@stylexjs/stylex'
import { useState, type Ref } from 'react'
import type { Availability } from '../../core/ai/capabilities'
import type { ContextStats } from '../../core/ai/sessionCache'
import { contextBudget } from '../contextBudget'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Tip } from './Tip'

interface Props {
  title: string
  model: Availability
  progress?: number
  stats?: ContextStats
  showMenu: boolean
  menuRef?: Ref<HTMLButtonElement>
  onMenu: () => void
  onSettings: () => void
  onCapabilities: () => void
  /** Markdown of the current chat, or undefined when there is nothing to copy yet */
  getChatMarkdown?: () => Promise<string | undefined>
}

const STATUS: Record<Availability, string> = {
  available: 'The on-device model is ready. Everything runs on this device.',
  downloading: 'The on-device model is downloading.',
  downloadable: 'The on-device model needs to be downloaded before you can chat.',
  unavailable: 'Chrome’s built-in model is not available on this device.',
}

/** 9159 → "9.2k" for the narrow side panel */
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))

export function Header({ title, model, progress, stats, showMenu, menuRef, onMenu, onSettings, onCapabilities, getChatMarkdown }: Props) {
  const [copied, setCopied] = useState(false)
  const budget = stats && contextBudget(stats)
  const pct = progress != null ? Math.round(progress * 100) : undefined
  const statusText = model === 'downloading' && pct != null ? `${STATUS.downloading} ${pct}% done.` : STATUS[model]
  return (
    <header {...stylex.props(styles.header)}>
      {showMenu && <Button ref={menuRef} icon="menu" label="Show chats (⌘K)" aria-haspopup="dialog" onClick={onMenu} />}
      <h1 {...stylex.props(styles.title)}>{title}</h1>
      {stats && budget && (
        <Tip
          align="end"
          text={`Using ${stats.usage.toLocaleString()} of ${stats.window.toLocaleString()} tokens (${budget.pct}%). ${budget.left.toLocaleString()} left in this chat.${stats.compacted ? ' Earlier messages have been summarized.' : ''}`}
        >
          <span
            tabIndex={0}
            role="meter"
            aria-label="Model memory used by this chat"
            aria-valuenow={stats.usage}
            aria-valuemin={0}
            aria-valuemax={stats.window}
            aria-valuetext={`${budget.left.toLocaleString()} of ${stats.window.toLocaleString()} tokens left`}
            {...stylex.props(styles.budget)}
          >
            <span {...stylex.props(styles.meter)}>
              <span
                {...stylex.props(
                  styles.meterFill(budget.pct),
                  budget.level === 'filling' && styles.meterFilling,
                  budget.level === 'full' && styles.meterFull,
                )}
              />
            </span>
            <span {...stylex.props(styles.budgetText, styles.wide, budget.level === 'full' && styles.budgetTextFull)}>
              {budget.left.toLocaleString()} of {stats.window.toLocaleString()} tokens left
            </span>
            <span {...stylex.props(styles.budgetText, styles.narrow, budget.level === 'full' && styles.budgetTextFull)}>
              {compact(budget.left)} left
            </span>
          </span>
        </Tip>
      )}
      <Tip align="end" text={statusText}>
        <span tabIndex={0} role="img" aria-label={statusText} {...stylex.props(styles.chip)}>
          <span {...stylex.props(styles.dot, styles[model], model === 'downloading' && styles.ring(progress ?? 0))} />
          {model === 'downloading' && pct != null ? (
            <span {...stylex.props(styles.chipLabel)}>{pct}%</span>
          ) : (
            <span {...stylex.props(styles.chipLabel, styles.wide)}>On-device</span>
          )}
        </span>
      </Tip>
      {getChatMarkdown && (
        <Button
          icon={copied ? 'check' : 'copy'}
          label={copied ? 'Copied' : 'Copy chat as Markdown'}
          onClick={async () => {
            const md = await getChatMarkdown()
            if (!md) return
            await navigator.clipboard.writeText(md)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        />
      )}
      <Button icon="info" label="What works here" onClick={onCapabilities} />
      <Button icon="settings" label="Settings" onClick={onSettings} />
    </header>
  )
}

const spin = stylex.keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } })

const NARROW = '@media (max-width: 480px)'

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
  budget: { display: 'inline-flex', alignItems: 'center', gap: space.sm, cursor: 'default', borderRadius: radius.sm },
  budgetText: { fontSize: font.xs, fontVariantNumeric: 'tabular-nums', color: color.muted, whiteSpace: 'nowrap' },
  wide: { display: { default: 'inline', [NARROW]: 'none' } },
  narrow: { display: { default: 'none', [NARROW]: 'inline' } },
  budgetTextFull: { color: color.warn, fontWeight: 600 },
  meter: {
    position: 'relative',
    width: size.meter,
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
  meterFilling: { backgroundColor: color.warn },
  meterFull: { backgroundColor: color.danger },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    height: size.chip,
    paddingInline: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.surface,
    cursor: 'default',
  },
  chipLabel: { fontSize: font.xs, fontWeight: 600, color: color.muted, letterSpacing: '0.02em' },
  dot: { position: 'relative', width: size.dotLg, height: size.dotLg, borderRadius: radius.pill, flexShrink: 0 },
  available: { backgroundColor: color.signal, boxShadow: `0 0 0 3px color-mix(in srgb, ${color.signal} 22%, transparent)` },
  downloadable: { backgroundColor: color.warn },
  unavailable: { backgroundColor: color.danger },
  downloading: {
    backgroundColor: 'transparent',
    animationName: spin,
    animationDuration: motion.loop,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  ring: (p: number) => ({
    backgroundImage: `conic-gradient(${color.accent} ${Math.max(0.08, p) * 360}deg, ${color.sunken} 0)`,
  }),
})
