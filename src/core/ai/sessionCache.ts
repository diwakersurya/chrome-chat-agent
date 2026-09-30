import type { ModelMessage } from '@tanstack/ai'
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
const RESERVE = 768

type ToolCallLike = { id: string; function: { name: string; arguments: string } }

// ---------- keys (cheap, sync) ----------

function partKey(p: any): string {
  if (p.type === 'text') return p.content
  const src = p.source ?? {}
  const v: string = src.value ?? ''
  return `[${p.type}:${src.mimeType ?? ''}:${v.length}:${v.slice(-24)}]`
}

function textOf(content: ModelMessage['content']): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { content: string }).content)
    .join('\n')
}

function toolNameFor(messages: ModelMessage[], i: number) {
  const tid = messages[i]!.toolCallId
  for (let j = i - 1; j >= 0; j--) {
    const call = (messages[j]!.toolCalls as ToolCallLike[] | undefined)?.find((c) => c.id === tid)
    if (call) return call.function.name
  }
  return messages[i]!.name ?? 'tool'
}

export function toolCallTextFor(call: ToolCallLike) {
  let args: unknown = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    // keep {}
  }
  return JSON.stringify({ action: 'tool', tool: call.function.name, args })
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
      content.push({ type: 'image', value: new Blob([bytes], { type: (p.source as any).mimeType }) })
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

// ---------- cache ----------

export class SessionCache {
  private entries = new Map<string, Entry>()

  constructor(private summarise?: Summarise) {}

  stats(conversationId: string): ContextStats | undefined {
    const e = this.entries.get(conversationId)
    if (!e) return undefined
    return { usage: e.session.contextUsage, window: e.session.contextWindow, compacted: e.offset }
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

  /** Make the session hold messages[0..n-2]; return the last message converted for prompting. */
  async prepare(conversationId: string, messages: ModelMessage[], config: SessionConfig, signal?: AbortSignal) {
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
    return { session: e!.session, last }
  }

  commitAnswer(conversationId: string, _last: LanguageModelMessage, text: string) {
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
    this.drop(conversationId)
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
    const entry: Entry = {
      session,
      configKey,
      offset,
      summary,
      summarisedKeys: keys.slice(0, offset).join('\u0001'),
      fed: keys.slice(offset, n - 1),
    }
    this.entries.set(conversationId, entry)
    return entry
  }

  private async compact(
    conversationId: string,
    messages: ModelMessage[],
    keys: string[],
    config: SessionConfig,
    configKey: string,
    signal?: AbortSignal,
  ) {
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
