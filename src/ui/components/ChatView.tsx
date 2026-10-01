import * as stylex from '@stylexjs/stylex'
import { chat, convertMessagesToModelMessages, generateMessageId, maxIterations } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'
import { stream, useChat, type UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import { ChromeTextAdapter, MAX_TOOL_STEPS, routerPrompt, type ChromeModelOptions } from '../../core/ai/chromeAdapter'
import type { ContextStats } from '../../core/ai/sessionCache'
import { SessionCache } from '../../core/ai/sessionCache'
import * as task from '../../core/ai/taskApis'
import { db, useDbQuery } from '../../core/db/client'
import { buildTools } from '../../core/tools/registry'
import { usePlatform, type PageContext } from '../../platform/platform'
import {
  availableTasks,
  draftToContent,
  isBlankAssistant,
  messageText,
  runTask,
  taskLabel,
  userContent,
} from '../chatContent'
import { friendlyError } from '../errors'
import type { Settings } from '../state'
import { useToast } from '../toast'
import { color, font, radius, shadow, space, size, motion } from '../tokens.stylex'
import { useConversationPersistence } from '../useConversationPersistence'
import { useSessionWarmup } from '../useSessionWarmup'
import { useToolSources } from '../useToolSources'
import { Button } from './Button'
import { Composer, type Draft } from './Composer'
import { ContextNotices } from './ContextNotices'
import { Icon } from './Icon'
import { Message } from './Message'
import type { TaskId } from './TaskMenu'
import { ApprovalCards, SourceChips } from './ToolBar'

// One adapter (and session cache) for the whole app. Compaction summaries use
// the Summarizer API when it works; otherwise the chat model, else old turns are dropped.
export const adapter = new ChromeTextAdapter(new SessionCache((t) => task.summarize(t, 'key-points', 'long')))

export { NEW_TITLE } from '../chatContent'

interface Props {
  conversationId: string
  initialMessages: UIMessage[]
  exists: boolean
  caps: Capabilities
  settings: Settings
  /** settings have loaded from the DB (the session shouldn't be built with defaults) */
  settingsReady: boolean
  incomingPage?: PageContext
  /** the composer took the incoming page; App can forget it */
  onIncomingUsed: () => void
  onStats: (s: ContextStats | undefined) => void
  onNewChat: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

/** What the model is doing right now, shown under the skeleton. */
type Stage = { label: string } | undefined

export function ChatView(props: Props) {
  const { conversationId, initialMessages, exists, caps, settings, settingsReady, onStats, onNewChat, inputRef } = props
  const platform = usePlatform()
  const toast = useToast()
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskFailure, setTaskFailure] = useState<{ id: string; task: TaskId; message: string }>()
  const [stage, setStage] = useState<Stage>()
  const [announce, setAnnounce] = useState('')

  const sources = useToolSources()
  const { data: allSkills } = useDbQuery(() => db.listSkills(), [], ['skills'])
  const skills = useMemo(() => (allSkills ?? []).filter((x) => x.enabled), [allSkills])
  const builtin = useMemo(
    () => (settings.toolsEnabled ? buildTools({ caps, platform, db }, settings.disabledTools) : []),
    [caps, platform, settings.toolsEnabled, settings.disabledTools],
  )
  // external tools are chosen per chat with "@", so they apply even if built-ins are off
  const tools = useMemo(() => [...builtin, ...sources.tools], [builtin, sources.tools])

  const modelOptions: ChromeModelOptions = {
    conversationId,
    systemPrompt: settings.systemPrompt,
    toolsEnabled: settings.toolsEnabled || sources.tools.length > 0,
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
    onChunk: (c) => {
      const chunk = c as StreamChunk & { name?: string; value?: { stage?: string }; toolName?: string }
      if (chunk.type === 'CUSTOM' && chunk.name === 'stage' && chunk.value?.stage === 'routing')
        setStage({ label: 'Deciding whether a tool would help…' })
      else if (chunk.type === 'TOOL_CALL_END') setStage({ label: `Running ${chunk.toolName?.replace(/_/g, ' ') ?? 'a tool'}…` })
      else if (chunk.type === 'TEXT_MESSAGE_CONTENT') setStage(undefined)
    },
  })
  const busy = isLoading || taskBusy

  // summarising older turns can take a while; say so
  useEffect(() => {
    const onCompact = (e: Event) =>
      (e as CustomEvent<string>).detail === conversationId && setStage({ label: 'Summarizing older messages to make room…' })
    adapter.sessions.events.addEventListener('compact', onCompact)
    return () => adapter.sessions.events.removeEventListener('compact', onCompact)
  }, [conversationId])

  useConversationPersistence({ conversationId, exists, initialMessages, messages, busy })
  const warm = useSessionWarmup({ adapter, conversationId, initialMessages, modelOptions, ready: settingsReady })

  // after each turn: refresh the memory budget, clear the stage, tell screen readers once
  const wasLoading = useRef(false)
  useEffect(() => {
    if (wasLoading.current && !isLoading) {
      warm.refresh()
      setStage(undefined)
      setAnnounce(error ? 'The reply failed.' : 'Reply finished.')
    }
    wasLoading.current = isLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])
  useEffect(() => onStats(warm.stats), [warm.stats, onStats])

  // how much model memory the router prompt for external tools costs
  const [toolTokens, setToolTokens] = useState<number>()
  useEffect(() => {
    if (!sources.tools.length) return setToolTokens(undefined)
    let alive = true
    adapter.sessions.measure(conversationId, routerPrompt(tools)).then(
      (m) => alive && setToolTokens(m.tokens),
      () => undefined,
    )
    return () => void (alive = false)
  }, [tools, sources.tools.length, conversationId])

  // callbacks read messages through a ref so they stay stable and memoised
  // Message rows don't re-render on every streamed token
  const msgs = useRef(messages)
  msgs.current = messages

  const send = useCallback(
    (d: Draft) => {
      setTaskFailure(undefined)
      void sendMessage(draftToContent(d))
    },
    [sendMessage],
  )

  /** Resend from a user message; later turns are removed, with Undo. */
  const resendFrom = useCallback(
    (userIndex: number, replaceText?: string) => {
      const before = msgs.current
      const user = before[userIndex]
      if (!user) return
      const removed = before.length - userIndex - 1
      setTaskFailure(undefined)
      setMessages(before.slice(0, userIndex))
      void sendMessage(userContent(user, replaceText))
      if (removed > 1)
        toast.show({
          text: `Removed ${removed - 1} later message${removed - 1 === 1 ? '' : 's'}`,
          action: {
            label: 'Undo',
            run: () => {
              stop()
              setMessages(before)
            },
          },
        })
    },
    [setMessages, sendMessage, stop, toast],
  )

  const onEdit = useCallback(
    (id: string, text: string) => resendFrom(msgs.current.findIndex((m) => m.id === id), text),
    [resendFrom],
  )

  const onRegenerate = useCallback(
    (id: string) => {
      const list = msgs.current
      const i = list.findIndex((m) => m.id === id)
      for (let u = i - 1; u >= 0; u--) if (list[u]!.role === 'user') return resendFrom(u)
    },
    [resendFrom],
  )

  const onTask = useCallback(
    async (id: string, t: TaskId) => {
      const source = msgs.current.find((m) => m.id === id)
      if (!source) return
      setTaskBusy(true)
      setTaskFailure(undefined)
      setStage({ label: `${taskLabel(t).replace(' (Chrome AI)', '')}…` })
      try {
        const result = await runTask(t, messageText(source))
        setMessages([
          ...msgs.current,
          {
            id: generateMessageId(),
            role: 'assistant',
            parts: [{ type: 'text', content: result }],
            metadata: { task: taskLabel(t) },
            createdAt: new Date(),
          },
        ])
      } catch (e) {
        setTaskFailure({ id, task: t, message: `${taskLabel(t).replace(' (Chrome AI)', '')} failed. ${friendlyError(e)}` })
      } finally {
        setTaskBusy(false)
        setStage(undefined)
      }
    },
    [setMessages],
  )

  const retryChat = () => {
    const i = msgs.current.findLastIndex((m) => m.role === 'user')
    if (i >= 0) resendFrom(i)
  }

  // Stick to the bottom while streaming, unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, busy, stage])
  const jumpToLatest = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    pinnedRef.current = true
    setPinned(true)
  }

  const tasks = useMemo(() => availableTasks(caps), [caps])
  const measure = useCallback((text: string) => adapter.sessions.measure(conversationId, text), [conversationId])
  const last = messages.at(-1)
  const lastAssistantId = messages.findLast((m) => m.role === 'assistant' && !m.metadata?.task)?.id
  const waiting = (isLoading && last?.role === 'user') || taskBusy

  return (
    <div {...stylex.props(styles.shell)}>
      <div
        ref={scroller}
        {...stylex.props(styles.scroll)}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          pinnedRef.current = atBottom
          if (atBottom !== pinned) setPinned(atBottom)
        }}
      >
        <div {...stylex.props(styles.column)}>
          {!messages.length && (
            <EmptyState hasTab={!!platform.getPageContext} onPick={(text) => send({ text, attachments: [], skills: [] })} />
          )}
          {messages.map((m, i) =>
            isBlankAssistant(m) && m !== last ? null : (
              <div key={m.id}>
                {(warm.stats?.compacted ?? 0) > 0 && i === warm.stats!.compacted && (
                  <p {...stylex.props(styles.divider)}>Earlier messages were summarized to fit the model’s memory</p>
                )}
                <Message
                  message={m}
                  streaming={isLoading && m === last && m.role === 'assistant'}
                  busy={busy}
                  tasks={tasks}
                  canRegenerate={m.id === lastAssistantId}
                  onEdit={onEdit}
                  onRegenerate={onRegenerate}
                  onTask={onTask}
                />
              </div>
            ),
          )}
          {waiting && <Skeleton />}
          {busy && stage && (
            <p role="status" {...stylex.props(styles.stage)}>
              {stage.label}
            </p>
          )}
          {!busy && taskFailure && (
            <div role="alert" {...stylex.props(styles.error)}>
              <Icon name="alert" />
              <span>{taskFailure.message}</span>
              <Button variant="quiet" icon="refresh" onClick={() => onTask(taskFailure.id, taskFailure.task)}>
                Try again
              </Button>
            </div>
          )}
          {!busy && !taskFailure && error && (
            <div role="alert" {...stylex.props(styles.error)}>
              <Icon name="alert" />
              <span>{friendlyError(error)}</span>
              <Button variant="quiet" icon="refresh" onClick={retryChat}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
      <span role="status" aria-live="polite" {...stylex.props(styles.srOnly)}>
        {announce}
      </span>
      <div {...stylex.props(styles.composer)}>
        {!pinned && messages.length > 0 && (
          <Button variant="quiet" icon="download" onClick={jumpToLatest} xstyle={styles.jump}>
            Jump to latest
          </Button>
        )}
        <ApprovalCards />
        <SourceChips chips={sources.chips} onRemove={sources.remove} dropped={sources.dropped} toolTokens={toolTokens} />
        <ContextNotices stats={warm.stats} overflow={warm.overflow} onNewChat={onNewChat} />
        <Composer
          caps={caps}
          busy={busy}
          onSend={send}
          onStop={stop}
          incomingPage={props.incomingPage}
          onIncomingUsed={props.onIncomingUsed}
          inputRef={inputRef}
          measure={measure}
          full={warm.overflow}
          skills={skills}
          sources={sources.items}
          onAddSource={sources.add}
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

/** Sized like a short reply so the first tokens don't shift the layout. */
function Skeleton() {
  return (
    <div aria-hidden {...stylex.props(styles.skeleton)}>
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
    position: 'relative',
    width: '100%',
    maxWidth: `calc(${size.readable} + 2 * ${space.lg})`,
    marginInline: 'auto',
    paddingInline: space.lg,
    paddingBottom: space.lg,
  },
  jump: {
    position: 'absolute',
    bottom: `calc(100% + ${space.sm})`,
    left: '50%',
    transform: 'translateX(-50%)',
    borderRadius: radius.pill,
    boxShadow: shadow.popover,
    zIndex: 5,
  },
  divider: {
    textAlign: 'center',
    fontFamily: font.ui,
    fontSize: font.xs,
    color: color.muted,
    marginBlock: space.lg,
  },
  stage: {
    margin: 0,
    marginTop: `calc(-1 * ${space.md})`,
    marginBottom: space.xl,
    fontFamily: font.ui,
    fontSize: font.xs,
    color: color.muted,
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
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
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
    animationDuration: motion.loop,
    animationIterationCount: 'infinite',
  },
  boneW: (pct: number) => ({ width: `${pct}%` }),
})
