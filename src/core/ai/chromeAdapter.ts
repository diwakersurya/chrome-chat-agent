import { convertSchemaToJsonSchema } from '@tanstack/ai'
import { BaseTextAdapter } from '@tanstack/ai/adapters'
import type { StructuredOutputOptions, StructuredOutputResult } from '@tanstack/ai/adapters'
import type { AdapterYieldChunk, ModelMessage, TextOptions } from '@tanstack/ai'
import { SessionCache, type SessionConfig } from './sessionCache'
import { expectedOutputs } from './capabilities'

export interface ChromeModelOptions extends SessionConfig {
  conversationId: string
  toolsEnabled?: boolean
}

export const MAX_TOOL_STEPS = 3

type AnyToolLike = { name: string; description?: string; inputSchema?: unknown }

type Decision = { action: 'answer' } | { action: 'tool'; tool: string; args: Record<string, unknown> }

/** Serialised assistant turn used when the router picked a tool. Must be deterministic:
 *  the session cache compares it against TanStack's stored assistant tool-call message. */
export const toolCallText = (tool: string, args: unknown) => JSON.stringify({ action: 'tool', tool, args })

export function routerSchema(toolNames: string[]) {
  return {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['answer', 'tool'] },
      tool: { type: 'string', enum: toolNames },
      args: { type: 'object' },
    },
    required: ['action'],
    additionalProperties: false,
  }
}

export function routerPrompt(tools: AnyToolLike[]) {
  const list = tools
    .map((t) => {
      const schema = t.inputSchema ? JSON.stringify(convertSchemaToJsonSchema(t.inputSchema as never)) : '{}'
      return `- ${t.name}: ${t.description ?? ''}\n  args JSON schema: ${schema}`
    })
    .join('\n')
  return [
    'You may call ONE tool before answering the latest user message.',
    'Available tools:',
    list,
    'Call a tool only when it clearly helps (current page, past chats, maths, dates, translation, summaries...).',
    'If a tool result above already answers the question, choose "answer".',
    'Respond with JSON: {"action":"answer"} or {"action":"tool","tool":"<name>","args":{...}}.',
  ].join('\n')
}

export function parseDecision(raw: string, toolNames: string[]): Decision {
  try {
    const d = JSON.parse(raw)
    if (d?.action === 'tool' && toolNames.includes(d.tool)) {
      return { action: 'tool', tool: d.tool, args: d.args && typeof d.args === 'object' ? d.args : {} }
    }
  } catch {
    // invalid JSON from the model → just answer
  }
  return { action: 'answer' }
}

/** Number of tool calls already made since the last user message. */
export function toolStepsSinceUser(messages: ModelMessage[]) {
  let steps = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'user') break
    if (m.role === 'assistant' && m.toolCalls?.length) steps++
  }
  return steps
}

const id = () => crypto.randomUUID()

export class ChromeTextAdapter extends BaseTextAdapter<
  'gemini-nano',
  ChromeModelOptions,
  readonly ['text', 'image', 'audio'],
  any
> {
  readonly name = 'chrome-built-in'

  constructor(readonly sessions: SessionCache = new SessionCache()) {
    super({}, 'gemini-nano')
  }

  async *chatStream(options: TextOptions<ChromeModelOptions>): AsyncIterable<AdapterYieldChunk> {
    const opts = options.modelOptions as ChromeModelOptions | undefined
    if (!opts?.conversationId) throw new Error('chromeAdapter: modelOptions.conversationId is required')
    const signal = options.abortController?.signal
    const runId = options.runId ?? id()
    const threadId = options.threadId ?? opts.conversationId
    const ev = (type: string, extra: Record<string, unknown> = {}) =>
      ({ type, timestamp: Date.now(), ...extra }) as unknown as AdapterYieldChunk

    yield ev('RUN_STARTED', { runId, threadId, model: this.model })
    try {
      const { session, last } = await this.sessions.prepare(opts.conversationId, options.messages, opts, signal)

      const tools = (options.tools ?? []) as AnyToolLike[]
      const canRoute =
        opts.toolsEnabled !== false && tools.length > 0 && toolStepsSinceUser(options.messages) < MAX_TOOL_STEPS
      if (canRoute) {
        const names = tools.map((t) => t.name)
        const probe = await session.clone({ signal })
        let raw: string
        try {
          raw = await probe.prompt([last, { role: 'user', content: routerPrompt(tools) }], {
            signal,
            responseConstraint: routerSchema(names),
          })
        } finally {
          probe.destroy()
        }
        const decision = parseDecision(raw, names)
        if (decision.action === 'tool') {
          const argsJson = JSON.stringify(decision.args)
          await this.sessions.commitToolCall(opts.conversationId, last, toolCallText(decision.tool, decision.args), signal)
          const toolCallId = id()
          const messageId = id()
          yield ev('TOOL_CALL_START', {
            toolCallId,
            toolCallName: decision.tool,
            toolName: decision.tool,
            parentMessageId: messageId,
            index: 0,
          })
          yield ev('TOOL_CALL_ARGS', { toolCallId, delta: argsJson, args: argsJson })
          yield ev('TOOL_CALL_END', { toolCallId, toolName: decision.tool, input: decision.args })
          yield ev('RUN_FINISHED', { runId, threadId, finishReason: 'tool_calls' })
          return
        }
      }

      const messageId = id()
      yield ev('TEXT_MESSAGE_START', { messageId, role: 'assistant' })
      let full = ''
      const stream = session.promptStreaming([last], { signal })
      try {
        for await (const delta of stream as unknown as AsyncIterable<string>) {
          full += delta
          yield ev('TEXT_MESSAGE_CONTENT', { messageId, delta, content: full })
        }
      } finally {
        // Record what the session actually saw, even for partial (stopped) replies.
        this.sessions.commitAnswer(opts.conversationId, last, full)
      }
      yield ev('TEXT_MESSAGE_END', { messageId })
      yield ev('RUN_FINISHED', { runId, threadId, finishReason: 'stop' })
    } catch (err) {
      if (signal?.aborted) {
        yield ev('RUN_FINISHED', { runId, threadId, finishReason: 'stop' })
        return
      }
      yield ev('RUN_ERROR', { runId, threadId, error: { message: errorMessage(err) } })
    }
  }

  async structuredOutput(o: StructuredOutputOptions<ChromeModelOptions>): Promise<StructuredOutputResult> {
    const s = await LanguageModel.create({ expectedOutputs: expectedOutputs() })
    try {
      const text = o.chatOptions.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
      const rawText = await s.prompt(text, { responseConstraint: o.outputSchema as Record<string, unknown> })
      return { data: JSON.parse(rawText), rawText }
    } finally {
      s.destroy()
    }
  }
}

export function errorMessage(err: unknown) {
  if (err instanceof DOMException) {
    if (err.name === 'NotSupportedError') return 'This input type is not supported by the on-device model.'
    if (err.name === 'QuotaExceededError') return 'The conversation is too long for the model context.'
  }
  return err instanceof Error ? err.message : String(err)
}

export const chromeText = () => new ChromeTextAdapter()
