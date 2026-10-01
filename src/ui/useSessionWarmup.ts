import { convertMessagesToModelMessages } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-react'
import { useEffect, useState } from 'react'
import type { ChromeModelOptions } from '../core/ai/chromeAdapter'
import { isContextFull } from '../core/ai/chromeAdapter'
import type { ContextStats } from '../core/ai/sessionCache'
import type { ChromeTextAdapter } from '../core/ai/chromeAdapter'

interface Options {
  adapter: ChromeTextAdapter
  conversationId: string
  initialMessages: UIMessage[]
  modelOptions: ChromeModelOptions
  /** wait until settings are loaded so the session isn't built with defaults and rebuilt */
  ready: boolean
}

/**
 * Prepares the model session when a chat opens, so its memory budget shows at
 * once and the first reply doesn't pay for loading the history.
 */
export function useSessionWarmup({ adapter, conversationId, initialMessages, modelOptions, ready }: Options) {
  const [stats, setStats] = useState<ContextStats>()
  /** the saved history can't be loaded into any session (e.g. one message is bigger than the window) */
  const [overflow, setOverflow] = useState(false)

  useEffect(() => {
    if (!ready) return
    const ac = new AbortController()
    if (!initialMessages.length) {
      // new chat: show the model's full window before the first message
      adapter.sessions.measure(conversationId, ' ').then(
        (m) => !ac.signal.aborted && !adapter.sessions.stats(conversationId) && setStats({ usage: 0, window: m.window, compacted: 0 }),
        () => undefined,
      )
    } else {
      adapter.sessions
        .warm(conversationId, convertMessagesToModelMessages(initialMessages), modelOptions, ac.signal)
        .then((s) => !ac.signal.aborted && setStats(s))
        .catch((e: unknown) => !ac.signal.aborted && isContextFull(e) && setOverflow(true)) // other errors surface on send
    }
    return () => ac.abort()
    // built once per chat; later settings changes rebuild lazily on the next send
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, ready])

  /** re-read usage after a turn */
  const refresh = () => {
    const s = adapter.sessions.stats(conversationId)
    if (s) setStats(s)
  }

  return { stats, overflow, refresh }
}
