import type { UIMessage } from '@tanstack/ai-react'
import { useEffect, useRef } from 'react'
import { db } from '../core/db/client'
import { makeTitle, messageText, NEW_TITLE, toStored } from './chatContent'

/** Cheap change signature: catches streamed text, edits and role changes without hashing images. */
function signature(m: UIMessage) {
  const json = JSON.stringify(m.parts)
  return `${m.role}|${json.length}|${json.slice(-64)}|${m.metadata ? JSON.stringify(m.metadata) : ''}`
}

/** while a reply streams, coalesce writes */
const STREAM_SAVE_DELAY = 700

interface Options {
  conversationId: string
  /** the conversation row already exists in the DB */
  exists: boolean
  initialMessages: UIMessage[]
  messages: UIMessage[]
  /** a reply or task is in progress */
  busy: boolean
}

/**
 * Saves a conversation incrementally:
 * - opening a chat doesn't rewrite it (or bump it to "Today");
 * - the user's message is saved as soon as it is sent, partial replies while streaming;
 * - a pending save is flushed when the chat closes, so switching mid-reply loses nothing.
 */
export function useConversationPersistence({ conversationId, exists, initialMessages, messages, busy }: Options) {
  const saved = useRef(new Map(initialMessages.map((m) => [m.id, signature(m)])))
  const savedOrder = useRef(initialMessages.map((m) => m.id).join())
  const created = useRef(exists)
  const titled = useRef(exists)
  const queue = useRef(Promise.resolve())
  const latest = useRef({ messages, busy })
  latest.current = { messages, busy }

  const save = () => {
    const { messages: list, busy: running } = latest.current
    if (!list.length) return
    const order = list.map((m) => m.id)
    const changed = list.filter((m) => saved.current.get(m.id) !== signature(m))
    if (!changed.length && order.join() === savedOrder.current) return
    const sigs = new Map(list.map((m) => [m.id, signature(m)]))
    const rows = changed.map(toStored)
    queue.current = queue.current
      .then(async () => {
        if (!created.current) {
          await db.createConversation(conversationId, NEW_TITLE)
          created.current = true
        }
        await db.syncMessages(conversationId, rows, order)
        saved.current = sigs
        savedOrder.current = order.join()
        const firstUser = list.find((m) => m.role === 'user')
        if (!running && !titled.current && firstUser && list.some((m) => m.role === 'assistant')) {
          titled.current = true
          await db.renameConversation(conversationId, await makeTitle(messageText(firstUser) || 'Image chat'))
        }
      })
      .catch((e) => console.error('Saving the chat failed', e))
  }

  useEffect(() => {
    const t = setTimeout(save, busy ? STREAM_SAVE_DELAY : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, busy])

  // flush when the chat closes (switching chats, new chat, unmount mid-reply)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => save(), [])
}
