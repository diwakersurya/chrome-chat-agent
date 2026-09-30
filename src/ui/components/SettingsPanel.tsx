import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import { db } from '../../core/db/client'
import type { ExportedConversation } from '../../core/db/repo'
import { allTools } from '../../core/tools/registry'
import { Gated } from './Gated'
import { CapabilitiesView } from './CapabilitiesView'
import { McpSettings } from './McpSettings'
import { SkillsSettings } from './SkillsSettings'
import { usePlatform } from '../../platform/platform'
import { DEFAULT_SETTINGS, type Settings, type Theme } from '../state'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'

interface Props {
  open: boolean
  onClose: () => void
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<unknown>
  caps: Capabilities
  storage?: { persistent: boolean; reason: string }
  onCleared: () => void
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

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toMarkdown(data: ExportedConversation[]) {
  return data
    .map((c) => {
      const body = c.messages
        .map((m) => {
          const text = (m.parts as any[])
            .map((p) =>
              p.type === 'text' ? p.content : p.type === 'tool-call' ? `_Used ${p.name}_` : p.type === 'image' ? '_[image]_' : '',
            )
            .filter(Boolean)
            .join('\n\n')
          return `**${m.role === 'user' ? 'You' : 'Assistant'}:**\n\n${text}`
        })
        .join('\n\n---\n\n')
      return `# ${c.title}\n\n${body}`
    })
    .join('\n\n\n')
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function SettingsPanel({ open, onClose, settings, update, caps, storage, onCleared, initialTab = 'general' }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  const ref = useRef<HTMLDialogElement>(null)
  const platform = usePlatform()
  const [prompt, setPrompt] = useState(settings.systemPrompt)
  const [params, setParams] = useState<{ maxTemperature: number; maxTopK: number; defaultTemperature: number; defaultTopK: number }>()
  const [note, setNote] = useState<string>()

  useEffect(() => setPrompt(settings.systemPrompt), [settings.systemPrompt])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  useEffect(() => {
    if (open && caps.sampling && 'params' in LanguageModel) {
      ;(LanguageModel as any).params().then(setParams, () => undefined)
    }
  }, [open, caps.sampling])

  const tools = allTools({ caps, platform, db })
  const customSampling = settings.temperature != null && settings.topK != null

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as ExportedConversation[]
      if (!Array.isArray(data)) throw new Error('Expected a list of conversations')
      await db.importAll(data)
      setNote(`Imported ${data.length} chat${data.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setNote(`Import failed: ${(e as Error).message}`)
    }
  }


  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} {...stylex.props(styles.dialog)}>
      <div {...stylex.props(styles.panel)}>
        <header {...stylex.props(styles.head)}>
          <h2 {...stylex.props(styles.h2)}>Settings</h2>
          <Button icon="x" label="Close settings" onClick={onClose} />
        </header>
        <div role="tablist" aria-label="Settings sections" {...stylex.props(styles.tabs)}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              {...stylex.props(styles.tab, tab === id && styles.tabActive)}
            >
              {label}
            </button>
          ))}
        </div>

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
        {tab === 'general' && (
          <>

        <section {...stylex.props(styles.section)}>
          <label htmlFor="system-prompt" {...stylex.props(styles.h3)}>
            System prompt
          </label>
          <textarea
            id="system-prompt"
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => prompt !== settings.systemPrompt && update('systemPrompt', prompt)}
            {...stylex.props(styles.textarea)}
          />
          <Button variant="quiet" onClick={() => (setPrompt(DEFAULT_SETTINGS.systemPrompt), update('systemPrompt', DEFAULT_SETTINGS.systemPrompt))}>
            Reset to default
          </Button>
        </section>

        <section {...stylex.props(styles.section)}>
            <h3 {...stylex.props(styles.h3)}>Sampling</h3>
            <label {...stylex.props(styles.row)}>
              <Gated feature="sampling">
              <input
                type="checkbox"
                checked={customSampling && caps.sampling}
                onChange={async (e) => {
                  if (e.target.checked) {
                    await update('temperature', params?.defaultTemperature ?? 1)
                    await update('topK', params?.defaultTopK ?? 3)
                  } else {
                    await update('temperature', null)
                    await update('topK', null)
                  }
                }}
              />
              </Gated>
              Use custom temperature and top-K
            </label>
            {customSampling && caps.sampling && (
              <>
                <label {...stylex.props(styles.slider)}>
                  <span>Temperature {settings.temperature!.toFixed(1)}</span>
                  <input
                    type="range"
                    min={0}
                    max={params?.maxTemperature ?? 2}
                    step={0.1}
                    value={settings.temperature!}
                    onChange={(e) => update('temperature', Number(e.target.value))}
                  />
                </label>
                <label {...stylex.props(styles.slider)}>
                  <span>Top-K {settings.topK}</span>
                  <input
                    type="range"
                    min={1}
                    max={params?.maxTopK ?? 128}
                    step={1}
                    value={settings.topK!}
                    onChange={(e) => update('topK', Number(e.target.value))}
                  />
                </label>
              </>
            )}
        </section>

        <section {...stylex.props(styles.section)}>
          <h3 {...stylex.props(styles.h3)}>Agent tools</h3>
          <label {...stylex.props(styles.row)}>
            <input type="checkbox" checked={settings.toolsEnabled} onChange={(e) => update('toolsEnabled', e.target.checked)} />
            Let the model use tools
          </label>
          <p {...stylex.props(styles.hint)}>
            Before each reply the model decides whether a tool would help. Turning tools off makes replies start faster.
          </p>
          <ul {...stylex.props(styles.toolList)}>
            {tools.map((t) => (
              <li key={t.name}>
                <label {...stylex.props(styles.row, !settings.toolsEnabled && styles.disabled)}>
                  <Gated feature="agent-tools" unless={{ when: !!t.unavailable, reason: t.unavailable ?? '' }}>
                  <input
                    type="checkbox"
                    disabled={!settings.toolsEnabled}
                    checked={!t.unavailable && !settings.disabledTools.includes(t.name)}
                    onChange={(e) =>
                      update(
                        'disabledTools',
                        e.target.checked
                          ? settings.disabledTools.filter((n) => n !== t.name)
                          : [...settings.disabledTools, t.name],
                      )
                    }
                  />
                  </Gated>
                  <span>
                    {t.label} <span {...stylex.props(styles.hint)}>{t.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section {...stylex.props(styles.section)}>
          <h3 {...stylex.props(styles.h3)}>Theme</h3>
          <div role="radiogroup" aria-label="Theme" {...stylex.props(styles.segment)}>
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <label key={t} {...stylex.props(styles.segItem, settings.theme === t && styles.segActive)}>
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={settings.theme === t}
                  onChange={() => update('theme', t)}
                  {...stylex.props(styles.srOnly)}
                />
                {t[0]!.toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </section>

        <section {...stylex.props(styles.section)}>
          <h3 {...stylex.props(styles.h3)}>Your data</h3>
          <p {...stylex.props(styles.hint)}>
            {storage?.persistent
              ? 'Chats are saved in this browser’s private storage (SQLite in OPFS). Nothing is uploaded.'
              : `Chats are not being saved: ${storage?.reason || 'storage unavailable'}. Close other tabs of this app and reload.`}
          </p>
          <div {...stylex.props(styles.buttons)}>
            <Button variant="quiet" icon="download" onClick={async () => download(`chats-${stamp()}.json`, 'application/json', JSON.stringify(await db.exportAll(), null, 2))}>
              Export JSON
            </Button>
            <Button variant="quiet" icon="download" onClick={async () => download(`chats-${stamp()}.md`, 'text/markdown', toMarkdown(await db.exportAll()))}>
              Export Markdown
            </Button>
            <label {...stylex.props(styles.fileBtn)}>
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirm('Delete all chats and settings from this browser? This can’t be undone.')) return
                await db.clearAll()
                onCleared()
                setNote('All chats and settings were deleted.')
              }}
            >
              Delete everything
            </Button>
          </div>
          {note && <p role="status" {...stylex.props(styles.hint)}>{note}</p>}
        </section>

          </>
        )}
      </div>
    </dialog>
  )
}

const slideIn = stylex.keyframes({ from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } })

const styles = stylex.create({
  dialog: {
    margin: 0,
    marginInlineStart: 'auto',
    height: '100dvh',
    maxHeight: '100dvh',
    width: 'min(420px, 100vw)',
    maxWidth: '100vw',
    padding: 0,
    borderWidth: 0,
    backgroundColor: color.surface,
    color: color.ink,
    boxShadow: '-12px 0 40px rgba(15, 25, 40, 0.18)',
    animationName: slideIn,
    animationDuration: motion.base,
    animationTimingFunction: motion.ease,
    '::backdrop': { backgroundColor: 'rgba(10, 16, 24, 0.35)' },
  },
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
  h3: { display: 'block', margin: 0, fontSize: font.sm, fontWeight: 600 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingInline: space.lg,
    paddingTop: space.xl,
  },
  textarea: {
    width: '100%',
    resize: 'vertical',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.bg,
    lineHeight: 1.5,
  },
  row: { display: 'flex', alignItems: 'flex-start', gap: space.sm, lineHeight: 1.45, cursor: 'pointer' },
  disabled: { opacity: 0.5 },
  slider: { display: 'flex', flexDirection: 'column', gap: space.xs, width: '100%', accentColor: color.accent },
  hint: { margin: 0, color: color.muted, lineHeight: 1.45 },
  toolList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.sm },
  segment: {
    display: 'inline-flex',
    padding: space.xxs,
    borderRadius: radius.md,
    backgroundColor: color.sunken,
  },
  segItem: {
    paddingInline: space.md,
    paddingBlock: space.xs,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.muted,
    ':focus-within': { outline: `2px solid ${color.focus}` },
  },
  segActive: { backgroundColor: color.surface, color: color.ink, fontWeight: 600 },
  srOnly: { position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  fileBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: size.control,
    paddingInline: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: { default: color.surface, ':hover': color.sunken },
    fontWeight: 500,
    cursor: 'pointer',
  },
  caps: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.xs, width: '100%' },
  capRow: { display: 'flex', alignItems: 'center', gap: space.sm },
  capDot: { width: '8px', height: '8px', borderRadius: radius.pill, flexShrink: 0 },
  capOn: { backgroundColor: color.signal },
  capOff: { backgroundColor: color.line },
})
