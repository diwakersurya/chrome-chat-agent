import { describe, expect, it } from 'vitest'
import { chat, maxIterations, toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { ChromeTextAdapter, parseDecision, toolStepsSinceUser } from './chromeAdapter'
import { detectCapabilities } from './capabilities'
import { installFakeLanguageModel } from './fakeLanguageModel'
import { SessionCache } from './sessionCache'

const addTool = toolDefinition({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
}).server(async ({ a, b }) => ({ sum: a + b }))

async function collect(stream: AsyncIterable<any>) {
  const events: any[] = []
  for await (const e of stream) events.push(e)
  return events
}

const textOf = (events: any[]) =>
  events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta).join('')

describe('parseDecision', () => {
  it('falls back to answer on bad JSON or unknown tool', () => {
    expect(parseDecision('nope', ['add'])).toEqual({ action: 'answer' })
    expect(parseDecision('{"action":"tool","tool":"rm"}', ['add'])).toEqual({ action: 'answer' })
    expect(parseDecision('{"action":"tool","tool":"add","args":{"a":1}}', ['add'])).toEqual({
      action: 'tool',
      tool: 'add',
      args: { a: 1 },
    })
  })

  it('counts tool steps since the last user message', () => {
    expect(
      toolStepsSinceUser([
        { role: 'user', content: 'x' },
        { role: 'assistant', content: null, toolCalls: [{} as any] },
        { role: 'tool', content: '1', toolCallId: 't' },
        { role: 'assistant', content: null, toolCalls: [{} as any] },
      ]),
    ).toBe(2)
  })
})

describe('ChromeTextAdapter via chat()', () => {
  it('streams a plain answer without tools', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['Hello there!'] })
    const adapter = new ChromeTextAdapter()
    const events = await collect(
      chat({
        adapter,
        messages: [{ role: 'user', content: 'hi' }],
        modelOptions: { conversationId: 'c1' },
      }) as AsyncIterable<any>,
    )
    expect(textOf(events)).toBe('Hello there!')
    expect(events.at(-1).type).toBe('RUN_FINISHED')
    expect(log.created).toHaveLength(1)
  })

  it('routes to a tool, runs it, then answers', async () => {
    const log = installFakeLanguageModel({
      prompts: ['{"action":"tool","tool":"add","args":{"a":2,"b":3}}', '{"action":"answer"}'],
      streams: ['The sum is 5.'],
    })
    const adapter = new ChromeTextAdapter()
    const events = await collect(
      chat({
        adapter,
        messages: [{ role: 'user', content: 'what is 2+3?' }],
        tools: [addTool],
        agentLoopStrategy: maxIterations(5),
        modelOptions: { conversationId: 'c2' },
      }) as AsyncIterable<any>,
    )
    const types = events.map((e) => e.type)
    expect(types).toContain('TOOL_CALL_START')
    expect(textOf(events)).toBe('The sum is 5.')
    // tool result was fed back as a user message on the same session (no rebuild)
    expect(log.created).toHaveLength(1)
    const secondRouterInput = JSON.stringify(log.prompted[1])
    expect(secondRouterInput).toContain('[tool:add result]')
    expect(secondRouterInput).toContain('5')
  })

  it('reuses the session across turns and rebuilds on divergence', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['A1', 'A2', 'B2'] })
    const adapter = new ChromeTextAdapter()
    const run = (messages: any[]) =>
      collect(chat({ adapter, messages, modelOptions: { conversationId: 'c3' } }) as AsyncIterable<any>)

    await run([{ role: 'user', content: 'q1' }])
    await run([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'q2' },
    ])
    expect(log.created).toHaveLength(1)

    // user edited q1 → history diverged → rebuild
    await run([
      { role: 'user', content: 'q1 edited' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'q2' },
    ])
    expect(log.created).toHaveLength(2)
  })
})

describe('context compaction', () => {
  it('summarizes older turns when the context window is nearly full', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['ok'] }, 1000)
    const summaries: string[] = []
    const adapter = new ChromeTextAdapter(
      new SessionCache(async (t) => {
        summaries.push(t)
        return 'SUMMARY'
      }),
    )
    const long = 'x'.repeat(600)
    const messages: any[] = []
    for (let i = 0; i < 6; i++) messages.push({ role: 'user', content: `${long}${i}` }, { role: 'assistant', content: `a${i}` })
    messages.push({ role: 'user', content: 'latest' })
    const events = await collect(chat({ adapter, messages, modelOptions: { conversationId: 'c4' } }) as AsyncIterable<any>)
    expect(textOf(events)).toBe('ok')
    expect(summaries).toHaveLength(1)
    const last = log.created.at(-1)!.initialPrompts as any[]
    expect(last[0].content).toContain('SUMMARY')
    expect(last.length).toBeLessThanOrEqual(5) // system + 4 recent turns
    expect(adapter.sessions.stats('c4')!.compacted).toBeGreaterThan(0)
  })
})

describe('Chrome 154 + Gemma 4 (speculative decoding)', () => {
  it('parses fenced or chatty router JSON', () => {
    expect(parseDecision('```json\n{"action":"tool","tool":"add","args":{"a":1}}\n```', ['add'])).toEqual({
      action: 'tool',
      tool: 'add',
      args: { a: 1 },
    })
    expect(parseDecision('Sure! {"action":"answer"}', ['add'])).toEqual({ action: 'answer' })
    // shapes Gemma 4 actually produced / other common ones
    const add = { action: 'tool', tool: 'add', args: { a: 1 } }
    expect(parseDecision('```json\n{"action":"add","args":{"a":1}}\n```', ['add'])).toEqual(add)
    expect(parseDecision('{"tool":"add","args":{"a":1}}', ['add'])).toEqual(add)
    expect(parseDecision('{"name":"add","arguments":"{\\"a\\":1}"}', ['add'])).toEqual(add)
    expect(parseDecision('{"tool_name":"add","parameters":{"a":1}}', ['add'])).toEqual(add)
    expect(parseDecision('{"action":"answer","tool":"add"}', ['add'])).toEqual({ action: 'answer' })
  })

  it('negotiates deterministic sampling and falls back from responseConstraint', async () => {
    const log = installFakeLanguageModel(
      {
        prompts: ['```json\n{"action":"tool","tool":"add","args":{"a":2,"b":3}}\n```', '{"action":"answer"}'],
        streams: ['The sum is 5.'],
      },
      4096,
      { mtp: true },
    )
    const caps = await detectCapabilities()
    expect(caps.prompt).toBe('available')
    expect(caps.deterministicOnly).toBe(true)
    expect(caps.sampling).toBe(false)

    const adapter = new ChromeTextAdapter()
    const events = await collect(
      chat({
        adapter,
        messages: [{ role: 'user', content: 'what is 2+3?' }],
        tools: [addTool],
        agentLoopStrategy: maxIterations(5),
        modelOptions: { conversationId: 'mtp' },
      }) as AsyncIterable<any>,
    )
    expect(events.find((e) => e.type === 'RUN_ERROR')).toBeUndefined()
    expect(events.map((e) => e.type)).toContain('TOOL_CALL_START')
    expect(textOf(events)).toBe('The sum is 5.')
    expect(log.created).toHaveLength(1)
  })
})

describe('warm', () => {
  it('prepares a saved chat so the next message reuses the session', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['A2'] })
    const adapter = new ChromeTextAdapter()
    const saved: any[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'A1' },
    ]
    const modelOptions = { conversationId: 'w1', systemPrompt: 'be brief' }
    const stats = await adapter.sessions.warm('w1', saved, modelOptions)
    expect(stats!.usage).toBeGreaterThan(0)
    await collect(chat({ adapter, messages: [...saved, { role: 'user', content: 'q2' }], modelOptions }) as AsyncIterable<any>)
    expect(log.created).toHaveLength(1)
  })
})

describe('context overflow on prompt', () => {
  it('compacts and retries when the model rejects the turn as too long', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['fits now'] })
    const LM = (globalThis as any).LanguageModel
    const create = LM.create
    let first = true
    LM.create = async (o: any) => {
      const s = await create(o)
      if (first) {
        first = false
        s.promptStreaming = () => {
          throw new DOMException('The input is too large.', 'QuotaExceededError')
        }
      }
      return s
    }
    const summaries: string[] = []
    const adapter = new ChromeTextAdapter(new SessionCache(async (t) => (summaries.push(t), 'SUMMARY')))
    const messages: any[] = []
    for (let i = 0; i < 6; i++) messages.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` })
    messages.push({ role: 'user', content: 'latest' })
    const events = await collect(chat({ adapter, messages, modelOptions: { conversationId: 'q1' } }) as AsyncIterable<any>)
    expect(events.find((e) => e.type === 'RUN_ERROR')).toBeUndefined()
    expect(textOf(events)).toBe('fits now')
    expect(summaries).toHaveLength(1)
    expect(log.created).toHaveLength(2)
  })
})

describe('empty replies', () => {
  it('rebuilds the session and retries once when the model returns nothing', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['', 'Hello!'] })
    const adapter = new ChromeTextAdapter()
    const events = await collect(
      chat({ adapter, messages: [{ role: 'user', content: 'hi' }], modelOptions: { conversationId: 'e1' } }) as AsyncIterable<any>,
    )
    expect(events.find((e) => e.type === 'RUN_ERROR')).toBeUndefined()
    expect(textOf(events)).toBe('Hello!')
    expect(log.created).toHaveLength(2)
  })

  it('reports an error when the retry is empty too', async () => {
    installFakeLanguageModel({ prompts: [], streams: ['', ''] })
    const adapter = new ChromeTextAdapter()
    const events = await collect(
      chat({ adapter, messages: [{ role: 'user', content: 'hi' }], modelOptions: { conversationId: 'e2' } }) as AsyncIterable<any>,
    )
    const err = events.find((e) => e.type === 'RUN_ERROR')
    expect(err?.message ?? err?.error?.message).toMatch(/empty reply/)
  })
})

describe('history hygiene', () => {
  it('never shows empty assistant turns to the model', async () => {
    const log = installFakeLanguageModel({ prompts: [], streams: ['ok'] })
    const adapter = new ChromeTextAdapter()
    await collect(
      chat({
        adapter,
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: '' },
          { role: 'user', content: 'q2' },
        ],
        modelOptions: { conversationId: 'h1' },
      }) as AsyncIterable<any>,
    )
    const initial = log.created[0]!.initialPrompts as any[]
    expect(initial.some((m) => m.role === 'assistant')).toBe(false)
  })
})
