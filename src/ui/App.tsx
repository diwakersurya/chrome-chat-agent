import * as stylex from '@stylexjs/stylex'
import type { UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { baseModelOptions } from '../core/ai/capabilities'
import type { ContextStats } from '../core/ai/sessionCache'
import { db, useDbQuery } from '../core/db/client'
import type { ConversationRow } from '../core/db/repo'
import { PlatformContext, type PageContext, type Platform } from '../platform/platform'
import { adapter, ChatView, NEW_TITLE } from './components/ChatView'
import { FeatureEnvContext } from './components/Gated'
import { Header } from './components/Header'
import type { FeatureEnv } from '../core/features'
import { ModelGate } from './components/ModelGate'
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { configureApprovals } from '../core/mcp/approval'
import { Sidebar } from './components/Sidebar'
import { Toast, type ToastData } from './components/Toast'
import { useCapabilities, useDbStatus, useSettings } from './state'
import { darkTheme, lightTheme } from './themes'
import { color, motion } from './tokens.stylex'

interface Active {
  id: string
  messages: UIMessage[]
  exists: boolean
}

const fresh = (): Active => ({ id: crypto.randomUUID(), messages: [], exists: false })

function useNarrow(query = '(max-width: 760px)') {
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

export function App({ platform }: { platform: Platform }) {
  const { caps, refresh } = useCapabilities()
  const { settings, update, loaded } = useSettings()
  const storage = useDbStatus()
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const openSettings = useCallback((tab: SettingsTab = 'general') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  // limitations upfront: show "What works here" once on first run
  useEffect(() => {
    if (!loaded || settings.seenCapabilities) return
    void update('seenCapabilities', true)
    openSettings('capabilities')
  }, [loaded, settings.seenCapabilities, update, openSettings])

  // external tool approvals: restore "always allow" choices and persist new ones
  useEffect(() => {
    configureApprovals(settings.mcpAlwaysAllow, (keys) => void update('mcpAlwaysAllow', keys))
  }, [settings.mcpAlwaysAllow, update])
  const [active, setActive] = useState<Active>(fresh)
  const [stats, setStats] = useState<ContextStats>()
  const [toast, setToast] = useState<ToastData>()
  const [progress, setProgress] = useState<number>()
  const [downloadError, setDownloadError] = useState<string>()
  const [incomingPage, setIncomingPage] = useState<PageContext>()
  const searchRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: rows = [] } = useDbQuery(() => db.listConversations(), [], ['conversations'])
  const title = rows.find((r) => r.id === active.id)?.title ?? NEW_TITLE

  // theme: StyleX theme on the root + data-theme for html/body and Shiki CSS
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.colorScheme = settings.theme === 'system' ? 'light dark' : settings.theme
  }, [settings.theme])

  const select = useCallback(async (id: string) => {
    setDrawer(false)
    const messages = (await db.getMessages(id)) as unknown as UIMessage[]
    setStats(undefined)
    setActive({
      id,
      exists: true,
      messages: messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt as unknown as number) })),
    })
  }, [])

  const newChat = useCallback(() => {
    setDrawer(false)
    setStats(undefined)
    setActive(fresh())
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const remove = useCallback(
    async (c: ConversationRow) => {
      const messages = await db.getMessages(c.id)
      await db.deleteConversation(c.id)
      adapter.sessions.drop(c.id)
      if (c.id === active.id) newChat()
      setToast({
        id: Date.now(),
        text: `Deleted “${c.title}”`,
        action: { label: 'Undo', run: () => void db.importAll([{ ...c, messages }]) },
      })
    },
    [active.id, newChat],
  )

  // model download (needs a click) and progress tracking
  const download = useCallback(async () => {
    setDownloadError(undefined)
    setProgress(0)
    try {
      const s = await LanguageModel.create({
        ...baseModelOptions(),
        monitor: (m) => m.addEventListener('downloadprogress', (e) => setProgress(e.loaded)),
      })
      s.destroy()
    } catch (e) {
      setDownloadError((e as Error).message)
    }
    setProgress(undefined)
    await refresh()
  }, [refresh])

  useEffect(() => {
    if (caps?.prompt === 'downloading') void download()
  }, [caps?.prompt, download])

  // selection sent from the extension's context menu
  useEffect(() => platform.onPendingSelection?.((ctx) => setIncomingPage({ ...ctx })), [platform])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setDrawer(true)
        requestAnimationFrame(() => searchRef.current?.focus())
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        newChat()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [newChat])

  const featureEnv = useMemo<FeatureEnv>(() => ({ target: platform.target, caps }), [platform.target, caps])
  const theme = settings.theme === 'dark' ? darkTheme : settings.theme === 'light' ? lightTheme : null
  const model = progress != null ? 'downloading' : (caps?.prompt ?? 'unavailable')
  const showSidebar = !narrow || drawer

  return (
    <PlatformContext.Provider value={platform}>
      <FeatureEnvContext.Provider value={featureEnv}>
      <div {...stylex.props(theme, styles.root)}>
        {narrow && drawer && <div {...stylex.props(styles.scrim)} onClick={() => setDrawer(false)} aria-hidden />}
        <div {...stylex.props(styles.side, narrow && styles.sideOverlay, narrow && !showSidebar && styles.sideHidden)} inert={!showSidebar}>
          <Sidebar activeId={active.id} onSelect={select} onNew={newChat} onDelete={remove} searchRef={searchRef} />
        </div>
        <main {...stylex.props(styles.main)}>
          <Header
            title={title}
            model={model}
            progress={progress}
            stats={stats}
            showMenu={narrow}
            onMenu={() => setDrawer(true)}
            onSettings={() => openSettings()}
            onCapabilities={() => openSettings('capabilities')}
          />
          {caps &&
            (model === 'available' ? (
              <ChatView
                key={active.id}
                conversationId={active.id}
                initialMessages={active.messages}
                exists={active.exists}
                caps={caps}
                settings={settings}
                incomingPage={incomingPage}
                onStats={setStats}
                onNewChat={newChat}
                inputRef={inputRef}
              />
            ) : (
              <ModelGate model={model} progress={progress} error={downloadError} onDownload={download} />
            ))}
        </main>
        {caps && (
          <SettingsPanel
            open={settingsOpen}
            initialTab={settingsTab}
            onClose={() => setSettingsOpen(false)}
            settings={settings}
            update={update}
            caps={caps}
            storage={storage}
            onCleared={() => {
              adapter.sessions.clear()
              newChat()
            }}
          />
        )}
        {toast && <Toast toast={toast} onDone={() => setToast(undefined)} />}
      </div>
      </FeatureEnvContext.Provider>
    </PlatformContext.Provider>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100%',
    backgroundColor: color.bg,
    color: color.ink,
    overflow: 'hidden',
  },
  side: {
    height: '100%',
    flexShrink: 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: motion.base,
    transitionTimingFunction: motion.ease,
  },
  sideOverlay: { position: 'fixed', insetBlock: 0, insetInlineStart: 0, zIndex: 20, boxShadow: '8px 0 30px rgba(15, 25, 40, 0.2)' },
  sideHidden: { transform: 'translateX(-100%)', opacity: 0, boxShadow: 'none' },
  scrim: { position: 'fixed', inset: 0, zIndex: 19, backgroundColor: 'rgba(10, 16, 24, 0.35)' },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' },
})
