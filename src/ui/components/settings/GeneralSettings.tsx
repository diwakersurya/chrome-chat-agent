import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import type { Capabilities } from '../../../core/ai/capabilities'
import { db } from '../../../core/db/client'
import type { ExportedConversation } from '../../../core/db/repo'
import { allTools } from '../../../core/tools/registry'
import { usePlatform } from '../../../platform/platform'
import { download, stamp } from '../../download'
import { conversationsToMarkdown } from '../../exportMarkdown'
import { DEFAULT_SETTINGS, type Settings, type Theme } from '../../state'
import { color, radius, space } from '../../tokens.stylex'
import { Button } from '../Button'
import { Gated } from '../Gated'
import { s } from './styles'

export interface GeneralProps {
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<unknown>
  caps: Capabilities
  storage?: { persistent: boolean; reason: string }
  open: boolean
  onCleared: () => void
}

/** Settings → General. */
export function GeneralSettings(p: GeneralProps) {
  return (
    <>
      <SystemPromptSection {...p} />
      <SamplingSection {...p} />
      <AgentToolsSection {...p} />
      <ThemeSection {...p} />
      <DataSection {...p} />
      <ShortcutsSection />
    </>
  )
}

function SystemPromptSection({ settings, update }: GeneralProps) {
  const [prompt, setPrompt] = useState(settings.systemPrompt)
  useEffect(() => setPrompt(settings.systemPrompt), [settings.systemPrompt])
  return (
    <section {...stylex.props(s.section)}>
      <label htmlFor="system-prompt" {...stylex.props(s.h3)}>
        System prompt
      </label>
      <textarea
        id="system-prompt"
        rows={5}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => prompt !== settings.systemPrompt && update('systemPrompt', prompt)}
        {...stylex.props(s.textarea)}
      />
      <Button variant="quiet" onClick={() => (setPrompt(DEFAULT_SETTINGS.systemPrompt), update('systemPrompt', DEFAULT_SETTINGS.systemPrompt))}>
        Reset to default
      </Button>
    </section>
  )
}

type Params = { maxTemperature: number; maxTopK: number; defaultTemperature: number; defaultTopK: number }

function SamplingSection({ settings, update, caps, open }: GeneralProps) {
  const [params, setParams] = useState<Params>()
  useEffect(() => {
    if (open && caps.sampling && LanguageModel.params) LanguageModel.params().then(setParams, () => undefined)
  }, [open, caps.sampling])
  const custom = settings.temperature != null && settings.topK != null && caps.sampling
  return (
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.h3)}>Sampling</h3>
      <label {...stylex.props(s.row)}>
        <Gated feature="sampling">
          <input
            type="checkbox"
            checked={custom}
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
      {custom && (
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
  )
}

function AgentToolsSection({ settings, update, caps }: GeneralProps) {
  const platform = usePlatform()
  const tools = allTools({ caps, platform, db })
  return (
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.h3)}>Built-in tools</h3>
      <label {...stylex.props(s.row)}>
        <input type="checkbox" checked={settings.toolsEnabled} onChange={(e) => update('toolsEnabled', e.target.checked)} />
        Let the model use built-in tools
      </label>
      <p {...stylex.props(s.hint)}>
        Before each reply the model decides whether a tool would help. Turning tools off makes replies start faster. Tools
        from MCP servers are added per chat with <kbd>@</kbd> (Settings → Tools).
      </p>
      <ul {...stylex.props(s.list)}>
        {tools.map((t) => (
          <li key={t.name}>
            <label {...stylex.props(s.row, !settings.toolsEnabled && styles.off)}>
              <Gated feature="agent-tools" unless={{ when: !!t.unavailable, reason: t.unavailable ?? '' }}>
                <input
                  type="checkbox"
                  disabled={!settings.toolsEnabled}
                  checked={!t.unavailable && !settings.disabledTools.includes(t.name)}
                  onChange={(e) =>
                    update(
                      'disabledTools',
                      e.target.checked ? settings.disabledTools.filter((n) => n !== t.name) : [...settings.disabledTools, t.name],
                    )
                  }
                />
              </Gated>
              <span>
                {t.label} <span {...stylex.props(s.hint)}>{t.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ThemeSection({ settings, update }: GeneralProps) {
  return (
    <section {...stylex.props(s.section)}>
      <h3 id="theme-label" {...stylex.props(s.h3)}>
        Theme
      </h3>
      <div role="radiogroup" aria-labelledby="theme-label" {...stylex.props(styles.segment)}>
        {(['system', 'light', 'dark'] as Theme[]).map((t) => (
          <label key={t} {...stylex.props(styles.segItem, settings.theme === t && styles.segActive)}>
            <input type="radio" name="theme" value={t} checked={settings.theme === t} onChange={() => update('theme', t)} {...stylex.props(styles.srOnly)} />
            {t[0]!.toUpperCase() + t.slice(1)}
          </label>
        ))}
      </div>
    </section>
  )
}

function DataSection({ storage, onCleared }: GeneralProps) {
  const [note, setNote] = useState<string>()
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
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.h3)}>Your data</h3>
      <p {...stylex.props(storage?.persistent ? s.hint : s.warn)}>
        {storage?.persistent
          ? 'Chats are saved in this browser’s private storage (SQLite in OPFS). Nothing is uploaded.'
          : `Chats are not being saved: ${storage?.reason || 'storage unavailable'}. Close other tabs of this app and reload.`}
      </p>
      <div {...stylex.props(s.buttons)}>
        <Button variant="quiet" icon="download" onClick={async () => download(`chats-${stamp()}.json`, 'application/json', JSON.stringify(await db.exportAll(), null, 2))}>
          Export JSON
        </Button>
        <Button variant="quiet" icon="download" onClick={async () => download(`chats-${stamp()}.md`, 'text/markdown', conversationsToMarkdown(await db.exportAll()))}>
          Export Markdown
        </Button>
        <label {...stylex.props(s.fileBtn)}>
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
            if (!confirm('Delete all chats, skills, servers and settings from this browser? This can’t be undone.')) return
            await db.clearAll()
            onCleared()
            setNote('Everything was deleted.')
          }}
        >
          Delete everything
        </Button>
      </div>
      {note && (
        <p role="status" {...stylex.props(s.hint)}>
          {note}
        </p>
      )}
    </section>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Enter', 'Send'],
  ['Shift + Enter', 'New line'],
  ['Esc', 'Stop the reply, or close a panel'],
  ['/', 'Use a skill'],
  ['@', 'Add tools to this chat'],
  ['⌘/Ctrl + K', 'Search chats'],
  ['⌘/Ctrl + Shift + O', 'New chat'],
]

function ShortcutsSection() {
  return (
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.h3)}>Keyboard shortcuts</h3>
      <dl {...stylex.props(styles.keys)}>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} {...stylex.props(styles.keyRow)}>
            <dt>
              <kbd {...stylex.props(styles.kbd)}>{k}</kbd>
            </dt>
            <dd {...stylex.props(styles.dd)}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const styles = stylex.create({
  off: { opacity: 0.5 },
  slider: { display: 'flex', flexDirection: 'column', gap: space.xs, width: '100%', accentColor: color.accent },
  segment: { display: 'inline-flex', padding: space.xxs, borderRadius: radius.md, backgroundColor: color.sunken },
  segItem: {
    paddingInline: space.md,
    paddingBlock: space.xs,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.muted,
    ':focus-within': { outline: `2px solid ${color.focus}`, outlineOffset: '1px' },
  },
  segActive: { backgroundColor: color.surface, color: color.ink, fontWeight: 600 },
  srOnly: { position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' },
  keys: { display: 'flex', flexDirection: 'column', gap: space.xs, margin: 0, width: '100%' },
  keyRow: { display: 'flex', alignItems: 'baseline', gap: space.md },
  kbd: {
    display: 'inline-block',
    minWidth: '8em',
    paddingInline: space.xs,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    fontFamily: 'inherit',
  },
  dd: { margin: 0, color: color.muted },
})
