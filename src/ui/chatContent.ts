import type { ContentPart } from '@tanstack/ai'
import type { MultimodalContent } from '@tanstack/ai-client'
import type { UIMessage } from '@tanstack/ai-react'
import type { Capabilities } from '../core/ai/capabilities'
import { usable } from '../core/ai/capabilities'
import * as task from '../core/ai/taskApis'
import type { StoredMessage } from '../core/db/repo'
import { textParts } from '../core/messages'
import { formatSkillPart, parseSkillPart } from '../core/skills/skills'
import type { Draft } from './components/Composer'
import { TASK_LABELS, type TaskId } from './tasks'
import { formatPageContext, parsePageContext } from './pageContext'

// Pure helpers that turn drafts, stored rows and UI messages into each other.

export const NEW_TITLE = 'New chat'

type Part = UIMessage['parts'][number]

export const toStored = (m: UIMessage): StoredMessage => ({
  id: m.id,
  role: m.role,
  parts: m.parts,
  ...(m.metadata ? { metadata: m.metadata } : {}),
  createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
})

export const fromStored = (m: StoredMessage): UIMessage => ({
  id: m.id,
  role: m.role,
  parts: m.parts as Part[],
  ...(m.metadata ? { metadata: m.metadata } : {}),
  createdAt: new Date(m.createdAt),
})

/** What the user wrote, without page-context and skill wrappers. */
export function messageText(m: Pick<UIMessage, 'parts'>) {
  return textParts(m.parts)
    .filter((t) => !parsePageContext(t) && !parseSkillPart(t))
    .join('\n\n')
}

/** Assistant messages with no visible content (failed or blank replies) are hidden. */
export const isBlankAssistant = (m: UIMessage) =>
  m.role === 'assistant' && !m.parts.some((p) => p.type !== 'text' || (p as { content: string }).content.trim())

export function availableTasks(caps: Capabilities): TaskId[] {
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

export async function runTask(id: TaskId, text: string) {
  if (id === 'summarize') return task.summarize(text, 'tldr')
  if (id === 'key-points') return task.summarize(text, 'key-points')
  if (id === 'proofread') return task.proofread(text)
  const [kind, arg] = id.split(':') as [string, string]
  if (kind === 'translate') return task.translate(text, arg)
  return arg === 'shorter' ? task.rewrite(text, 'as-is', 'shorter') : task.rewrite(text, arg as task.RewriteTone, 'as-is')
}

export const taskLabel = (t: TaskId) => `${TASK_LABELS[t]} (Chrome AI)`

export async function makeTitle(firstUserText: string) {
  const fallback = firstUserText.split('\n')[0]!.slice(0, 48) || NEW_TITLE
  try {
    const t = await task.summarize(firstUserText.slice(0, 2000), 'headline', 'short')
    return t.replace(/^[#*\s]+|[*.\s]+$/g, '').slice(0, 60) || fallback
  } catch {
    return fallback
  }
}

export function draftToContent(d: Draft): string | MultimodalContent {
  const parts: ContentPart[] = []
  for (const sk of d.skills) parts.push({ type: 'text', content: formatSkillPart(sk) })
  if (d.page) parts.push({ type: 'text', content: formatPageContext(d.page, d.page.body) })
  for (const a of d.attachments)
    parts.push({ type: a.kind, source: { type: 'data', value: a.data, mimeType: a.mimeType } } as ContentPart)
  if (d.text) parts.push({ type: 'text', content: d.text })
  const plain = parts.length === 1 && !d.page && !d.skills.length && !d.attachments.length
  return plain ? d.text : { content: parts }
}

/** A user message's parts as sendable content, optionally with new text (edit). */
export function userContent(m: UIMessage, replaceText?: string): MultimodalContent {
  const wrappers = m.parts.filter(
    (p) => p.type === 'text' && (parsePageContext(p.content) || parseSkillPart(p.content)),
  )
  const media = m.parts.filter((p) => p.type === 'image' || p.type === 'audio')
  const text = replaceText ?? messageText(m)
  return { content: [...wrappers, ...media, ...(text ? [{ type: 'text', content: text }] : [])] as ContentPart[] }
}
