import { describe, expect, it } from 'vitest'
import { chat, maxIterations, toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { ChromeTextAdapter, parseDecision, toolStepsSinceUser } from './chromeAdapter'
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
