import * as stylex from '@stylexjs/stylex'
import type { UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { baseModelOptions } from '../core/ai/capabilities'
import type { ContextStats } from '../core/ai/sessionCache'
import { db, useDbQuery } from '../core/db/client'
import type { ConversationRow } from '../core/db/repo'
import type { FeatureEnv } from '../core/features'
import { configureApprovals } from '../core/mcp/approval'
import { PlatformContext, type PageContext, type Platform } from '../platform/platform'
import { fromStored, NEW_TITLE } from './chatContent'
import { messagesToMarkdown } from './exportMarkdown'
import { adapter, ChatView } from './components/ChatView'
import { FeatureEnvContext } from './components/Gated'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { ModelGate } from './components/ModelGate'
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { Sidebar } from './components/Sidebar'
import { useCapabilities, useDbStatus, useSettings } from './state'
import { darkTheme, lightTheme } from './themes'
import { ToastProvider, useToast } from './toast'
import { color, font, motion, shadow, space } from './tokens.stylex'

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
  return (
    <PlatformContext.Provider value={platform}>
      <ToastProvider>
        <Workspace platform={platform} />
      </ToastProvider>
    </PlatformContext.Provider>
  )
}

function Workspace({ platform }: { platform: Platform }) {
  const { caps, refresh } = useCapabilities()
  const { settings, update, loaded } = useSettings()
  const storage = useDbStatus()
  const toast = useToast()
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [active, setActive] = useState<Active>(fresh)
  const [stats, setStats] = useState<ContextStats>()
  const [progress, setProgress] = useState<number>()
  const [downloadError, setDownloadError] = useState<string>()
  const [incomingPage, setIncomingPage] = useState<PageContext>()
  const searchRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)

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

  const { data: rows } = useDbQuery(() => db.listConversations(), [], ['conversations'])
  const title = rows?.find((r) => r.id === active.id)?.title ?? NEW_TITLE

  // theme: StyleX theme on the root + data-theme for html/body and Shiki CSS
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.colorScheme = settings.theme === 'system' ? 'light dark' : settings.theme
  }, [settings.theme])

  const focusComposer = () => requestAnimationFrame(() => inputRef.current?.focus())

  const openDrawer = useCallback(() => {
    setDrawer(true)
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [])
  const closeDrawer = useCallback((returnFocus = true) => {
    setDrawer(false)
    if (returnFocus) requestAnimationFrame(() => menuRef.current?.focus())
  }, [])

  const select = useCallback(async (id: string) => {
    setDrawer(false)
    const messages = await db.getMessages(id)
    setStats(undefined)
    setActive({ id, exists: true, messages: messages.map(fromStored) })
    focusComposer()
  }, [])

  const newChat = useCallback(() => {
    setDrawer(false)
    setStats(undefined)
    setActive(fresh())
    focusComposer()
  }, [])

  const remove = useCallback(
    async (c: ConversationRow) => {
      const messages = await db.getMessages(c.id)
      await db.deleteConversation(c.id)
      adapter.sessions.drop(c.id)
      if (c.id === active.id) newChat()
      toast.show({
        text: `Deleted “${c.title}”`,
        action: { label: 'Undo', run: () => void db.importAll([{ ...c, messages }]) },
      })
    },
    [active.id, newChat, toast],
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
        openDrawer()
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        newChat()
      }
      if (e.key === 'Escape' && narrow && drawer) {
        e.preventDefault()
        closeDrawer()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [newChat, openDrawer, closeDrawer, narrow, drawer])

  const featureEnv = useMemo<FeatureEnv>(() => ({ target: platform.target, caps }), [platform.target, caps])
  const theme = settings.theme === 'dark' ? darkTheme : settings.theme === 'light' ? lightTheme : null
  const model = progress != null ? 'downloading' : (caps?.prompt ?? 'unavailable')
  const showSidebar = !narrow || drawer
  const drawerOpen = narrow && drawer

  return (
    <FeatureEnvContext.Provider value={featureEnv}>
      <div {...stylex.props(theme, styles.root)}>
        {drawerOpen && <div {...stylex.props(styles.scrim)} onClick={() => closeDrawer()} aria-hidden />}
        <div
          {...stylex.props(styles.side, narrow && styles.sideOverlay, narrow && !showSidebar && styles.sideHidden)}
          inert={!showSidebar}
          role={drawerOpen ? 'dialog' : undefined}
          aria-modal={drawerOpen || undefined}
          aria-label={drawerOpen ? 'Chats' : undefined}
        >
          <Sidebar activeId={active.id} onSelect={select} onNew={newChat} onDelete={remove} searchRef={searchRef} />
        </div>
        <main {...stylex.props(styles.main)} inert={drawerOpen}>
          <Header
            title={title}
            model={model}
            progress={progress}
            stats={stats}
            showMenu={narrow}
            menuRef={menuRef}
            onMenu={openDrawer}
            onSettings={() => openSettings()}
            onCapabilities={() => openSettings('capabilities')}
            getChatMarkdown={
              rows?.some((r) => r.id === active.id)
                ? async () => `# ${title}\n\n${messagesToMarkdown(await db.getMessages(active.id))}`
                : undefined
            }
          />
          {storage && !storage.persistent && (
            <p role="alert" {...stylex.props(styles.storage)}>
              <Icon name="alert" />
              <span>
                Chats aren’t being saved right now: another tab of this app may be holding the storage. Close other tabs
                of this app and reload.{' '}
                <button type="button" onClick={() => openSettings()} {...stylex.props(styles.link)}>
                  Details
                </button>
              </span>
            </p>
          )}
          {caps &&
            (model === 'available' ? (
              <ChatView
                key={active.id}
                conversationId={active.id}
                initialMessages={active.messages}
                exists={active.exists}
                caps={caps}
                settings={settings}
                settingsReady={loaded}
                incomingPage={incomingPage}
                onIncomingUsed={() => setIncomingPage(undefined)}
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
      </div>
    </FeatureEnvContext.Provider>
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
  sideOverlay: { position: 'fixed', insetBlock: 0, insetInlineStart: 0, zIndex: 20, boxShadow: shadow.drawer },
  sideHidden: { transform: 'translateX(-100%)', opacity: 0, boxShadow: 'none' },
  scrim: { position: 'fixed', inset: 0, zIndex: 19, backgroundColor: color.scrim },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' },
  storage: {
    display: 'flex',
    gap: space.sm,
    margin: 0,
    paddingInline: space.lg,
    paddingBlock: space.sm,
    color: color.warn,
    fontFamily: font.ui,
    fontSize: font.sm,
    lineHeight: 1.45,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.line,
  },
  link: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: color.accent,
    textDecoration: 'underline',
    cursor: 'pointer',
  },
})
