import * as stylex from '@stylexjs/stylex'
import { chat, convertMessagesToModelMessages, generateMessageId, maxIterations } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'
import { stream, useChat, type UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import { usable } from '../../core/ai/capabilities'
import { ChromeTextAdapter, MAX_TOOL_STEPS, type ChromeModelOptions } from '../../core/ai/chromeAdapter'
import type { ContextStats } from '../../core/ai/sessionCache'
import { SessionCache } from '../../core/ai/sessionCache'
import * as task from '../../core/ai/taskApis'
import { db } from '../../core/db/client'
import type { StoredMessage } from '../../core/db/repo'
import { buildTools } from '../../core/tools/registry'
import { usePlatform, type PageContext } from '../../platform/platform'
import type { Settings } from '../state'
import { contextBudget } from '../contextBudget'
import { formatPageContext } from '../pageContext'
import { color, font, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Composer, type Draft } from './Composer'
import { Icon } from './Icon'
import { Message, messageText } from './Message'
import { TASK_LABELS, type TaskId } from './TaskMenu'

// One adapter (and session cache) for the whole app. Compaction summaries use
// the Summarizer API when present; otherwise old turns are dropped.
export const adapter = new ChromeTextAdapter(new SessionCache((t) => task.summarize(t, 'key-points', 'long')))

export const NEW_TITLE = 'New chat'

interface Props {
  conversationId: string
  initialMessages: UIMessage[]
  exists: boolean
  caps: Capabilities
  settings: Settings
  incomingPage?: PageContext
  onStats: (s: ContextStats | undefined) => void
  onNewChat: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

const toStored = (m: UIMessage): StoredMessage => ({
  id: m.id,
  role: m.role,
  parts: m.parts,
  ...(m.metadata ? { metadata: m.metadata } : {}),
  createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
})

function availableTasks(caps: Capabilities): TaskId[] {
  // every task falls back to the Prompt API, so a working model enables them all
  const prompt = usable(caps.prompt)
  const t: TaskId[] = []
  if (prompt || usable(caps.summarizer)) t.push('summarize', 'key-points')
  if (prompt || caps.translator)
    t.push('translate:en', 'translate:es', 'translate:fr', 'translate:de', 'translate:hi', 'translate:ja')
  if (prompt || usable(caps.rewriter)) t.push('rewrite:more-formal', 'rewrite:more-casual', 'rewrite:shorter')
  if (prompt || usable(caps.proofreader)) t.push('proofread')
  return t
}

async function runTask(id: TaskId, text: string) {
  if (id === 'summarize') return task.summarize(text, 'tldr')
  if (id === 'key-points') return task.summarize(text, 'key-points')
  if (id === 'proofread') return task.proofread(text)
  const [kind, arg] = id.split(':') as [string, string]
  if (kind === 'translate') return task.translate(text, arg)
  return task.rewrite(text, arg === 'shorter' ? 'as-is' : (arg as task.RewriteTone), arg === 'shorter' ? 'shorter' : 'as-is')
}

async function makeTitle(firstUserText: string) {
  const fallback = firstUserText.split('\n')[0]!.slice(0, 48) || NEW_TITLE
  try {
    const t = await task.summarize(firstUserText.slice(0, 2000), 'headline', 'short')
    return t.replace(/^[#*\s]+|[*.\s]+$/g, '').slice(0, 60) || fallback
  } catch {
    return fallback
  }
}

function draftToContent(d: Draft) {
  const parts: any[] = []
  if (d.page) parts.push({ type: 'text', content: formatPageContext(d.page, d.page.body) })
  for (const a of d.attachments) parts.push({ type: a.kind, source: { type: 'data', value: a.data, mimeType: a.mimeType } })
  if (d.text) parts.push({ type: 'text', content: d.text })
  return parts.length === 1 && parts[0].type === 'text' && !d.page ? d.text : parts
}

/** A user message's parts as sendable content (drops UI-only fields). */
function userContent(m: UIMessage, replaceText?: string) {
  const media = m.parts.filter((p: any) => p.type === 'image' || p.type === 'audio')
  const pages = m.parts.filter((p: any) => p.type === 'text' && p.content.startsWith('<page '))
  const text = replaceText ?? messageText(m)
  return [...pages, ...media, ...(text ? [{ type: 'text', content: text }] : [])] as any[]
}

export function ChatView({ conversationId, initialMessages, exists, caps, settings, incomingPage, onStats, onNewChat, inputRef }: Props) {
  const platform = usePlatform()
  const created = useRef(exists)
  const titled = useRef(exists)
  const saving = useRef(Promise.resolve())
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskError, setTaskError] = useState<string>()
  const [stats, setStats] = useState<ContextStats>()
  /** the saved history can't be loaded into any session (e.g. one message is bigger than the window) */
  const [overflow, setOverflow] = useState(false)

  const tools = useMemo(
    () => (settings.toolsEnabled ? buildTools({ caps, platform, db }, settings.disabledTools) : []),
    [caps, platform, settings.toolsEnabled, settings.disabledTools],
  )
  const modelOptions: ChromeModelOptions = {
    conversationId,
    systemPrompt: settings.systemPrompt,
    toolsEnabled: settings.toolsEnabled,
    image: caps.image,
    audio: caps.audio,
    ...(caps.sampling && settings.temperature != null && settings.topK != null
      ? { temperature: settings.temperature, topK: settings.topK }
      : {}),
  }
  const live = useRef({ tools, modelOptions })
  live.current = { tools, modelOptions }

  // The single model call path: useChat → stream() → chat() → ChromeTextAdapter.
  const connection = useMemo(
    () =>
      stream((messages, _data, signal) => {
        const abortController = new AbortController()
        signal?.addEventListener('abort', () => abortController.abort())
        return chat({
          adapter,
          messages: convertMessagesToModelMessages(messages as UIMessage[]),
          tools: live.current.tools,
          agentLoopStrategy: maxIterations(MAX_TOOL_STEPS + 1),
          modelOptions: live.current.modelOptions,
          abortController,
        }) as AsyncIterable<StreamChunk>
      }),
    [],
  )

  const { messages, sendMessage, setMessages, stop, isLoading, error } = useChat({
    initialMessages,
    connection,
  })

  // Opening a saved chat: build its session now so the context budget shows immediately.
  useEffect(() => {
    if (!initialMessages.length) {
      // new chat: show the model's full window before the first message
      let live = true
      adapter.sessions.measure(conversationId, ' ').then(
        (m) => {
          const s = { usage: 0, window: m.window, compacted: 0 }
          if (live && !adapter.sessions.stats(conversationId)) (setStats(s), onStats(s))
        },
        () => undefined,
      )
      return () => void (live = false)
    }
    const ac = new AbortController()
    adapter.sessions
      .warm(conversationId, convertMessagesToModelMessages(initialMessages), live.current.modelOptions, ac.signal)
      .then((s) => {
        if (ac.signal.aborted) return
        setStats(s)
        onStats(s)
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted && /QuotaExceeded|too large|context/i.test(`${e.name} ${e.message}`)) setOverflow(true)
      }) // other errors surface on the next send
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Persist whenever the conversation settles.
  useEffect(() => {
    if (isLoading || taskBusy || !messages.length) return
    const snapshot = messages.map(toStored)
    saving.current = saving.current.then(async () => {
      if (!created.current) {
        await db.createConversation(conversationId, NEW_TITLE)
        created.current = true
      }
      await db.saveMessages(conversationId, snapshot)
      const firstUser = messages.find((m) => m.role === 'user')
      if (!titled.current && firstUser && messages.some((m) => m.role === 'assistant')) {
        titled.current = true
        const title = await makeTitle(messageText(firstUser) || 'Image chat')
        await db.renameConversation(conversationId, title)
      }
    }).catch((e) => console.error('save failed', e))
    const s = adapter.sessions.stats(conversationId)
    setStats(s)
    onStats(s)
  }, [messages, isLoading, taskBusy, conversationId, onStats])

  const send = useCallback((d: Draft) => void sendMessage({ content: draftToContent(d) as any }), [sendMessage])

  const resendFrom = useCallback(
    (userIndex: number, replaceText?: string) => {
      const user = messages[userIndex]
      if (!user) return
      setMessages(messages.slice(0, userIndex))
      void sendMessage({ content: userContent(user, replaceText) })
    },
    [messages, setMessages, sendMessage],
  )

  const onEdit = useCallback(
    (id: string, text: string) => resendFrom(messages.findIndex((m) => m.id === id), text),
    [messages, resendFrom],
  )

  const onRegenerate = useCallback(
    (id: string) => {
      const i = messages.findIndex((m) => m.id === id)
      for (let u = i - 1; u >= 0; u--) if (messages[u]!.role === 'user') return resendFrom(u)
    },
    [messages, resendFrom],
  )

  const onTask = useCallback(
    async (id: string, t: TaskId) => {
      const source = messages.find((m) => m.id === id)
      if (!source) return
      setTaskBusy(true)
      setTaskError(undefined)
      try {
        const result = await runTask(t, messageText(source))
        setMessages([
          ...messages,
          {
            id: generateMessageId(),
            role: 'assistant',
            parts: [{ type: 'text', content: result }],
            metadata: { task: `${TASK_LABELS[t]} (Chrome AI)` },
            createdAt: new Date(),
          },
        ])
      } catch (e) {
        setTaskError(`${TASK_LABELS[t]} failed: ${(e as Error).message}`)
      } finally {
        setTaskBusy(false)
      }
    },
    [messages, setMessages],
  )

  const lastUserIndex = messages.findLastIndex((m) => m.role === 'user')
  const retry = () => lastUserIndex >= 0 && resendFrom(lastUserIndex)

  // Stick to the bottom while streaming, unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, isLoading, taskBusy])

  const tasks = useMemo(() => availableTasks(caps), [caps])
  const measure = useCallback((text: string) => adapter.sessions.measure(conversationId, text), [conversationId])
  const last = messages.at(-1)
  const waiting = (isLoading && last?.role === 'user') || taskBusy
  const busy = isLoading || taskBusy
  const compacted = stats?.compacted ?? 0

  return (
    <div {...stylex.props(styles.shell)}>
      <div
        ref={scroller}
        {...stylex.props(styles.scroll)}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div {...stylex.props(styles.column)} aria-live="polite">
          {!messages.length && <EmptyState hasTab={!!platform.getPageContext} onPick={(text) => send({ text, attachments: [] })} />}
          {messages.map((m, i) =>
            m.role === 'assistant' && m !== last && !m.parts.some((p: any) => p.type !== 'text' || p.content.trim()) ? null : (
            <div key={m.id}>
              {compacted > 0 && i === compacted && (
                <p {...stylex.props(styles.divider)}>Earlier messages were summarized to fit the model’s memory</p>
              )}
              <Message
                message={m}
                streaming={isLoading && m === last && m.role === 'assistant'}
                busy={busy}
                tasks={tasks}
                onEdit={onEdit}
                onRegenerate={onRegenerate}
                onTask={onTask}
              />
            </div>
            ),
          )}
          {waiting && <Skeleton />}
          {(error || taskError) && !busy && (
            <div role="alert" {...stylex.props(styles.error)}>
              <Icon name="alert" />
              <span>{taskError ?? error?.message}</span>
              {error && (
                <Button variant="quiet" icon="refresh" onClick={retry}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <div {...stylex.props(styles.composer)}>
        {overflow && (
          <div role="status" {...stylex.props(styles.fullNotice)}>
            <Icon name="alert" />
            <span {...stylex.props(styles.fullText)}>
              This chat no longer fits in the model’s memory, so it can’t continue. Start a new chat to keep going.
            </span>
            <Button variant="quiet" icon="plus" onClick={onNewChat}>
              Start new chat
            </Button>
          </div>
        )}
        {!overflow && stats && contextBudget(stats).level === 'full' && (
          <div role="status" {...stylex.props(styles.fullNotice)}>
            <Icon name="alert" />
            <span {...stylex.props(styles.fullText)}>
              This chat has used {contextBudget(stats).pct}% of the model’s memory (
              {contextBudget(stats).left.toLocaleString()} tokens left). Older messages will be summarized to make room, which
              can lose detail.
            </span>
            <Button variant="quiet" icon="plus" onClick={onNewChat}>
              Start new chat
            </Button>
          </div>
        )}
        <Composer
          caps={caps}
          busy={busy}
          onSend={send}
          onStop={stop}
          incomingPage={incomingPage}
          inputRef={inputRef}
          measure={measure}
          full={overflow}
        />
      </div>
    </div>
  )
}

function EmptyState({ hasTab, onPick }: { hasTab: boolean; onPick: (text: string) => void }) {
  const ideas = [
    ...(hasTab ? ['Summarize the page I’m on'] : []),
    'Explain how a hash map works, with a small example',
    'Plan a three-day trip to Lisbon on a budget',
    'What’s 17.5% of 2,340?',
  ]
  return (
    <div {...stylex.props(styles.empty)}>
      <h1 {...stylex.props(styles.emptyTitle)}>What’s on your mind?</h1>
      <p {...stylex.props(styles.emptyText)}>
        Chrome’s built-in model runs on this device. Your messages, files and history stay here.
      </p>
      <div {...stylex.props(styles.ideas)}>
        {ideas.map((t) => (
          <button key={t} type="button" onClick={() => onPick(t)} {...stylex.props(styles.idea)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-label="Thinking" role="status" {...stylex.props(styles.skeleton)}>
      <span {...stylex.props(styles.bone, styles.boneW(92))} />
      <span {...stylex.props(styles.bone, styles.boneW(78))} />
      <span {...stylex.props(styles.bone, styles.boneW(54))} />
    </div>
  )
}

const shimmer = stylex.keyframes({ '0%': { opacity: 0.35 }, '50%': { opacity: 0.8 }, '100%': { opacity: 0.35 } })

const styles = stylex.create({
  shell: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  scroll: { flex: 1, overflowY: 'auto', minHeight: 0, scrollbarGutter: 'stable' },
  column: {
    maxWidth: size.readable,
    marginInline: 'auto',
    paddingInline: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
  },
  composer: {
    width: '100%',
    maxWidth: `calc(${size.readable} + 2 * ${space.lg})`,
    marginInline: 'auto',
    paddingInline: space.lg,
    paddingBottom: space.lg,
  },
  fullNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    marginBottom: space.sm,
    color: color.warn,
    fontFamily: font.ui,
    fontSize: font.sm,
  },
  fullText: { flex: 1, minWidth: '200px', lineHeight: 1.4 },
  divider: {
    textAlign: 'center',
    fontFamily: font.ui,
    fontSize: font.xs,
    color: color.muted,
    marginBlock: space.lg,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    color: color.danger,
    fontFamily: font.ui,
    fontSize: font.sm,
    marginBottom: space.lg,
  },
  empty: { paddingTop: space.xxxl, paddingBottom: space.xl },
  emptyTitle: {
    margin: 0,
    fontFamily: font.prose,
    fontWeight: 400,
    fontSize: font.xl,
    letterSpacing: '-0.01em',
    color: color.ink,
  },
  emptyText: {
    marginTop: space.sm,
    marginBottom: space.xl,
    fontFamily: font.ui,
    fontSize: font.md,
    lineHeight: 1.5,
    color: color.muted,
    maxWidth: '52ch',
  },
  ideas: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.sm },
  idea: {
    textAlign: 'start',
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: { default: color.surface, ':hover': color.sunken },
    color: color.ink,
    fontFamily: font.ui,
    fontSize: font.sm,
    cursor: 'pointer',
  },
  skeleton: { display: 'flex', flexDirection: 'column', gap: space.sm, marginBottom: space.xl },
  bone: {
    display: 'block',
    height: '1.1em',
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    animationName: shimmer,
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
  },
  boneW: (pct: number) => ({ width: `${pct}%` }),
})
