import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { MentionItem } from '../components/MentionPicker'

export type Mention = { char: '/' | '@'; query: string; start: number }

/** "/que" or "@que" right before the caret opens a picker. */
export function mentionAt(text: string, caret: number): Mention | undefined {
  const m = /(^|\s)([/@])([\w.-]*)$/.exec(text.slice(0, caret))
  return m ? { char: m[2] as Mention['char'], query: m[3]!.toLowerCase(), start: caret - m[3]!.length - 1 } : undefined
}

interface Options {
  text: string
  setText: (t: string) => void
  ta: RefObject<HTMLTextAreaElement | null>
  /** items for the current trigger and query */
  itemsFor: (m: Mention) => MentionItem[]
  onPick: (m: Mention, item: MentionItem) => void
}

/**
 * "/" and "@" pickers in a textarea: detection at the caret, keyboard
 * navigation, picking (removes the typed trigger) and inserting a trigger.
 */
export function useMention({ text, setText, ta, itemsFor, onPick }: Options) {
  const [mention, setMention] = useState<Mention>()
  const [index, setIndex] = useState(0)
  // caret to restore after a programmatic text change, applied before the next keystroke
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current == null || !ta.current) return
    ta.current.focus()
    ta.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [text, ta])

  const items = mention ? itemsFor(mention) : []
  const active = Math.min(index, Math.max(0, items.length - 1))

  const sync = (value: string, at: number) => {
    const m = mentionAt(value, at)
    if (m?.query !== mention?.query || m?.char !== mention?.char) setIndex(0)
    setMention(m)
  }

  const pick = (item: MentionItem) => {
    if (!mention || item.unavailable) return
    const end = ta.current?.selectionStart ?? text.length
    setText(text.slice(0, mention.start) + text.slice(end))
    caret.current = mention.start
    setMention(undefined)
    onPick(mention, item)
  }

  /** Put a trigger character at the caret, e.g. from the Skills / Tools buttons. */
  const insert = (char: Mention['char']) => {
    const at = ta.current?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const add = (before && !/\s$/.test(before) ? ' ' : '') + char
    setText(before + add + text.slice(at))
    const pos = at + add.length
    caret.current = pos
    setMention({ char, query: '', start: pos - 1 })
    setIndex(0)
  }

  /** Returns true when the key was handled by the picker. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!mention) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = items.length || 1
      setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
      e.preventDefault()
      pick(items[active]!)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMention(undefined)
      return true
    }
    return false
  }

  return { mention, items, active, setIndex, sync, pick, insert, onKeyDown, close: () => setMention(undefined) }
}
