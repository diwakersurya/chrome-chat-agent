import type { ModelMessage } from '@tanstack/ai'
import { textOf } from '../messages'
import { baseModelOptions, isDeterministicOnly } from './capabilities'

// One LanguageModel session per conversation. TanStack sends the full history
// on every call; re-prompting a fresh session with the whole history each turn
// would re-process everything, so we keep the session alive and only feed it
// the new tail. Any divergence (edit, regenerate, settings change) rebuilds it.

export interface SessionConfig {
  systemPrompt?: string
  temperature?: number
  topK?: number
  /** declare multimodal inputs so image/audio parts are accepted */
  image?: boolean
  audio?: boolean
}

export interface ContextStats {
  usage: number
  window: number
  /** number of leading messages folded into a summary */
  compacted: number
}

interface Entry {
  session: LanguageModel
  configKey: string
  /** index into the conversation where `fed` starts (messages before it are summarised) */
  offset: number
  summary?: string
  /** keys of the summarised messages, so a later edit inside them invalidates the summary */
  summarisedKeys: string
  fed: string[]
  pendingKey?: string
}

type Summarise = (text: string) => Promise<string>

const KEEP_RECENT = 4
/** live sessions kept in memory; each holds model state in GPU/RAM */
const MAX_SESSIONS = 2
/** tokens kept free for the model's reply */
export const RESERVE = 768

type ToolCallLike = { id: string; function: { name: string; arguments: string } }

// ---------- keys (cheap, sync) ----------

function partKey(p: any): string {
  if (p.type === 'text') return p.content
  const src = p.source ?? {}
  const v: string = src.value ?? ''
  return `[${p.type}:${src.mimeType ?? ''}:${v.length}:${v.slice(-24)}]`
}

function toolNameFor(messages: ModelMessage[], i: number) {
  const tid = messages[i]!.toolCallId
  for (let j = i - 1; j >= 0; j--) {
    const call = (messages[j]!.toolCalls as ToolCallLike[] | undefined)?.find((c) => c.id === tid)
    if (call) return call.function.name
  }
  return messages[i]!.name ?? 'tool'
}

/**
 * The assistant turn recorded for a tool call. The adapter appends exactly
 * this to the session, and the cache recomputes it from TanStack's stored
 * tool-call message, so both sides must use this one function.
 */
export const toolCallText = (tool: string, args: unknown) => JSON.stringify({ action: 'tool', tool, args })

function toolCallTextFor(call: ToolCallLike) {
  let args: unknown = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    // keep {}
  }
  return toolCallText(call.function.name, args)
}

export function messageKey(messages: ModelMessage[], i: number): string {
  const m = messages[i]!
  if (m.role === 'assistant') {
    const calls = m.toolCalls as ToolCallLike[] | undefined
    return calls?.length ? `a:${toolCallTextFor(calls[0]!)}` : `a:${textOf(m.content)}`
  }
  if (m.role === 'tool') return `u:${toolResultText(toolNameFor(messages, i), textOf(m.content))}`
  const c = m.content
  return `u:${typeof c === 'string' ? c : (c ?? []).map(partKey).join('\u0000')}`
}

const toolResultText = (name: string, result: string) => `[tool:${name} result]\n${result}`

// ---------- conversion (async: decodes media) ----------

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sourceBytes(src: any): Promise<Uint8Array<ArrayBuffer>> {
  if (src.type === 'data') return b64ToBytes(src.value)
  const res = await fetch(src.value)
  return new Uint8Array(await res.arrayBuffer())
}

async function toPromptMessage(messages: ModelMessage[], i: number): Promise<LanguageModelMessage> {
  const m = messages[i]!
  if (m.role === 'assistant') {
    const calls = m.toolCalls as ToolCallLike[] | undefined
    return { role: 'assistant', content: calls?.length ? toolCallTextFor(calls[0]!) : textOf(m.content) }
  }
  if (m.role === 'tool') {
    return { role: 'user', content: toolResultText(toolNameFor(messages, i), textOf(m.content)) }
  }
  if (typeof m.content === 'string' || m.content == null) return { role: 'user', content: m.content ?? '' }
  const content: LanguageModelMessageContent[] = []
  for (const p of m.content) {
    if (p.type === 'text') content.push({ type: 'text', value: p.content })
    else if (p.type === 'image') {
      const bytes = await sourceBytes(p.source)
      content.push({ type: 'image', value: new Blob([bytes], { type: 'mimeType' in p.source ? p.source.mimeType : undefined }) })
    } else if (p.type === 'audio') {
      // decode recorded audio (webm/opus etc.) so the model gets raw PCM
      const bytes = await sourceBytes(p.source)
      const ctx = new AudioContext()
      try {
        content.push({ type: 'audio', value: await ctx.decodeAudioData(bytes.buffer) })
      } finally {
        void ctx.close()
      }
    }
  }
  return { role: 'user', content }
}

/**
 * Empty assistant turns (failed or blank replies) make Gemma return "" for
 * later prompts, so they are never shown to the model.
 */
export const modelVisible = (messages: ModelMessage[]) =>
  messages.filter((m) => !(m.role === 'assistant' && !m.toolCalls?.length && !textOf(m.content).trim()))

// ---------- cache ----------

export interface DraftMeasure {
  tokens: number
  window: number
  /** tokens the conversation already uses (0 for a chat without a session yet) */
  usage: number
}

export class SessionCache {
  /** insertion order doubles as recency: touched entries are re-inserted */
  private entries = new Map<string, Entry>()
  /** serialises warm/prepare/compact per conversation so two builds can't race */
  private locks = new Map<string, Promise<unknown>>()
  /** fires 'compact' (detail: conversationId) when older turns are being summarised */
  readonly events = new EventTarget()
  /** shared session used only to count tokens for chats that have no session yet */
  private measurer?: Promise<LanguageModel>

  constructor(private summarise?: Summarise) {}

  stats(conversationId: string): ContextStats | undefined {
    const e = this.entries.get(conversationId)
    if (!e) return undefined
    return { usage: e.session.contextUsage, window: e.session.contextWindow, compacted: e.offset }
  }

  /** Token cost of a draft message, measured by the model's own tokenizer. */
  async measure(conversationId: string, text: string): Promise<DraftMeasure> {
    const e = this.entries.get(conversationId)
    let session = e?.session
    if (!session) {
      this.measurer ??= LanguageModel.create(baseModelOptions() as LanguageModelCreateOptions)
      this.measurer.catch(() => (this.measurer = undefined))
      session = await this.measurer
    }
    const tokens = await session.measureContextUsage([{ role: 'user', content: text }])
    return { tokens, window: session.contextWindow, usage: e ? session.contextUsage : 0 }
  }

  drop(conversationId: string) {
    try {
      this.entries.get(conversationId)?.session.destroy()
    } catch {
      // already dead (model service restarted)
    }
    this.entries.delete(conversationId)
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id)
  }

  private locked<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(conversationId) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(fn)
    this.locks.set(conversationId, run)
    void run.finally(() => this.locks.get(conversationId) === run && this.locks.delete(conversationId)).catch(() => undefined)
    return run
  }

  /** Mark as most recently used and evict the oldest idle sessions beyond MAX_SESSIONS. */
  private touch(conversationId: string, e: Entry) {
    this.entries.delete(conversationId)
    this.entries.set(conversationId, e)
    for (const [id, other] of this.entries) {
      if (this.entries.size <= MAX_SESSIONS) break
      // never evict a chat that is in the middle of a turn
      if (id !== conversationId && !other.pendingKey) this.drop(id)
    }
  }

  /**
   * Build the session for an existing chat ahead of the next message, so its
   * context usage is known on open and the first reply doesn't pay the rebuild.
   */
  warm(conversationId: string, all: ModelMessage[], config: SessionConfig, signal?: AbortSignal) {
    return this.locked(conversationId, async () => {
      const messages = modelVisible(all)
      if (!messages.length || this.entries.has(conversationId)) return this.stats(conversationId)
      // rebuild() feeds messages[0..n-2]; pass a placeholder tail so every real message is included
      const withTail = [...messages, { role: 'user', content: '' } as ModelMessage]
      const keys = withTail.map((_, i) => messageKey(withTail, i))
      await this.rebuild(conversationId, withTail, keys, config, JSON.stringify(config), 0, undefined, signal)
      return this.stats(conversationId)
    })
  }

  /** Make the session hold messages[0..n-2]; return the last message converted for prompting. */
  prepare(conversationId: string, all: ModelMessage[], config: SessionConfig, signal?: AbortSignal) {
    return this.locked(conversationId, () => this.prepareUnlocked(conversationId, all, config, signal))
  }

  private async prepareUnlocked(conversationId: string, all: ModelMessage[], config: SessionConfig, signal?: AbortSignal) {
    const messages = modelVisible(all)
    if (!messages.length) throw new Error('No messages to send')
    const n = messages.length
    const keys = messages.map((_, i) => messageKey(messages, i))
    const configKey = JSON.stringify(config)
    let e = this.entries.get(conversationId)

    const matches =
      e &&
      e.configKey === configKey &&
      e.offset <= n - 1 &&
      e.fed.length === n - 1 - e.offset &&
      e.fed.every((k, j) => k === keys[e!.offset + j])

    if (!matches) {
      const reuse = e && e.offset <= n - 1 && e.summarisedKeys === keys.slice(0, e.offset).join('\u0001')
      e = await this.rebuild(
        conversationId,
        messages,
        keys,
        config,
        configKey,
        reuse ? e!.offset : 0,
        reuse ? e!.summary : undefined,
        signal,
      )
    }

    const last = await toPromptMessage(messages, n - 1)
    const need = await e!.session.measureContextUsage([last], { signal })
    if (e!.session.contextUsage + need + RESERVE > e!.session.contextWindow) {
      e = await this.compact(conversationId, messages, keys, config, configKey, signal)
    }
    e!.pendingKey = keys[n - 1]
    this.touch(conversationId, e!)
    return { session: e!.session, last }
  }

  commitAnswer(conversationId: string, text: string) {
    const e = this.entries.get(conversationId)
    if (!e?.pendingKey) return
    e.fed.push(e.pendingKey, `a:${text}`)
    e.pendingKey = undefined
  }

  async commitToolCall(conversationId: string, last: LanguageModelMessage, callText: string, signal?: AbortSignal) {
    const e = this.entries.get(conversationId)
    if (!e?.pendingKey) return
    await e.session.append([last, { role: 'assistant', content: callText }], { signal })
    e.fed.push(e.pendingKey, `a:${callText}`)
    e.pendingKey = undefined
  }

  private async rebuild(
    conversationId: string,
    messages: ModelMessage[],
    keys: string[],
    config: SessionConfig,
    configKey: string,
    offset: number,
    summary: string | undefined,
    signal?: AbortSignal,
  ): Promise<Entry> {
    const n = messages.length
    const history: LanguageModelMessage[] = []
    for (let i = offset; i < n - 1; i++) history.push(await toPromptMessage(messages, i))
    const system = [config.systemPrompt, summary && `Summary of the earlier conversation:\n${summary}`]
      .filter(Boolean)
      .join('\n\n')
    const expectedInputs: LanguageModelExpected[] = [{ type: 'text' }]
    if (config.image) expectedInputs.push({ type: 'image' })
    if (config.audio) expectedInputs.push({ type: 'audio' })
    // custom temperature/topK can't be combined with the deterministic sampling MTP requires
    const sampling =
      config.temperature != null && config.topK != null && !isDeterministicOnly()
        ? { temperature: config.temperature, topK: config.topK }
        : {}
    const session = await LanguageModel.create({
      ...baseModelOptions(),
      ...sampling,
      expectedInputs,
      signal,
      initialPrompts: [...(system ? [{ role: 'system' as const, content: system }] : []), ...history],
    } as LanguageModelCreateOptions)
    // a cancelled build (chat closed, newer build) must not leak its session
    if (signal?.aborted) {
      session.destroy()
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    this.drop(conversationId)
    const entry: Entry = {
      session,
      configKey,
      offset,
      summary,
      summarisedKeys: keys.slice(0, offset).join('\u0001'),
      fed: keys.slice(offset, n - 1),
    }
    this.touch(conversationId, entry)
    return entry
  }

  /** The model rejected a turn as too long: summarise older turns now so the retry fits. */
  compactNow(conversationId: string, all: ModelMessage[], config: SessionConfig, signal?: AbortSignal) {
    return this.locked(conversationId, async () => {
      const messages = modelVisible(all)
      const keys = messages.map((_, i) => messageKey(messages, i))
      await this.compact(conversationId, messages, keys, config, JSON.stringify(config), signal)
    })
  }

  private async compact(
    conversationId: string,
    messages: ModelMessage[],
    keys: string[],
    config: SessionConfig,
    configKey: string,
    signal?: AbortSignal,
  ) {
    this.events.dispatchEvent(new CustomEvent('compact', { detail: conversationId }))
    const n = messages.length
    const offset = Math.max(0, n - 1 - KEEP_RECENT)
    const old = messages
      .slice(0, offset)
      .map((m) => `${m.role}: ${textOf(m.content)}`)
      .join('\n')
    let summary: string | undefined
    if (old && this.summarise) {
      try {
        summary = await this.summarise(old.slice(-12000))
      } catch {
        summary = undefined // fall back to simply dropping old turns
      }
    }
    return this.rebuild(conversationId, messages, keys, config, configKey, offset, summary, signal)
  }
}
