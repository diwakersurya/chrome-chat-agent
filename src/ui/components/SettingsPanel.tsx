import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { color, font, motion, shadow, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { CapabilitiesView } from './CapabilitiesView'
import { GeneralSettings, type GeneralProps } from './settings/GeneralSettings'
import { McpSettings } from './settings/McpSettings'
import { SkillsSettings } from './settings/SkillsSettings'

interface Props extends Omit<GeneralProps, 'open'> {
  open: boolean
  onClose: () => void
  /** tab to show when the panel opens */
  initialTab?: SettingsTab
}

export type SettingsTab = 'general' | 'skills' | 'tools' | 'capabilities'
const TABS: [SettingsTab, string][] = [
  ['general', 'General'],
  ['skills', 'Skills'],
  ['tools', 'Tools'],
  ['capabilities', 'What works here'],
]

/** Side sheet with tabs. Slides in and out; Escape and the backdrop close it. */
export function SettingsPanel({ open, onClose, initialTab = 'general', ...general }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setClosing(false)
      d.showModal()
    }
    if (!open && d.open) setClosing(true)
  }, [open])

  // play the exit animation, then really close
  const requestClose = () => setClosing(true)
  const onAnimationEnd = () => {
    if (!closing) return
    ref.current?.close()
    setClosing(false)
    onClose()
  }

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next]![0])
    tabRefs.current[next]?.focus()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="settings-title"
      onCancel={(e) => (e.preventDefault(), requestClose())}
      onClick={(e) => e.target === ref.current && requestClose()}
      onAnimationEnd={onAnimationEnd}
      {...stylex.props(styles.dialog, closing && styles.closing)}
    >
      <div {...stylex.props(styles.panel)}>
        <header {...stylex.props(styles.head)}>
          <h2 id="settings-title" {...stylex.props(styles.h2)}>
            Settings
          </h2>
          <Button icon="x" label="Close settings (Esc)" onClick={requestClose} />
        </header>
        <div role="tablist" aria-label="Settings sections" {...stylex.props(styles.tabs)}>
          {TABS.map(([id, label], i) => (
            <button
              key={id}
              ref={(el) => void (tabRefs.current[i] = el)}
              id={`tab-${id}`}
              role="tab"
              type="button"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => onTabKey(e, i)}
              {...stylex.props(styles.tab, tab === id && styles.tabActive)}
            >
              {label}
            </button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} {...stylex.props(styles.tabpanel)}>
          {tab === 'general' && <GeneralSettings {...general} open={open} />}
          {tab === 'skills' && (
            <section {...stylex.props(styles.section)}>
              <SkillsSettings />
            </section>
          )}
          {tab === 'tools' && (
            <section {...stylex.props(styles.section)}>
              <McpSettings />
            </section>
          )}
          {tab === 'capabilities' && (
            <section {...stylex.props(styles.section)}>
              <CapabilitiesView />
            </section>
          )}
        </div>
      </div>
    </dialog>
  )
}

const slideIn = stylex.keyframes({ from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } })
const slideOut = stylex.keyframes({ from: { transform: 'none', opacity: 1 }, to: { transform: 'translateX(24px)', opacity: 0 } })

const styles = stylex.create({
  dialog: {
    margin: 0,
    marginInlineStart: 'auto',
    height: '100dvh',
    maxHeight: '100dvh',
    width: `min(${size.panel}, 100vw)`,
    maxWidth: '100vw',
    padding: 0,
    borderWidth: 0,
    backgroundColor: color.surface,
    color: color.ink,
    boxShadow: shadow.panel,
    animationName: slideIn,
    animationDuration: motion.base,
    animationTimingFunction: motion.ease,
    '::backdrop': { backgroundColor: color.scrim },
  },
  closing: { animationName: slideOut, animationFillMode: 'forwards' },
  panel: { display: 'flex', flexDirection: 'column', fontFamily: font.ui, fontSize: font.sm, paddingBottom: space.xxl },
  head: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: space.lg,
    paddingBlock: space.md,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.line,
  },
  h2: { margin: 0, fontSize: font.lg, fontWeight: 600 },
  tabs: {
    display: 'flex',
    gap: space.xxs,
    paddingInline: space.lg,
    paddingTop: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.line,
    overflowX: 'auto',
  },
  tab: {
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    color: color.muted,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  tabActive: { color: color.ink, borderBottomColor: color.accent },
  tabpanel: { outline: 'none' },
  section: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingInline: space.lg,
    paddingTop: space.xl,
  },
})
