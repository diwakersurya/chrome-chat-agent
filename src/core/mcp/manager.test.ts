import { describe, expect, it } from 'vitest'
import { chat, maxIterations, toolDefinition } from '@tanstack/ai'
import { createMCPClient } from '@tanstack/ai-mcp'
import { createMCPServer } from '@tanstack/ai-mcp/server'
import { z } from 'zod'
import type { McpServerRow } from '../db/repo'
import { ChromeTextAdapter } from '../ai/chromeAdapter'
import { installFakeLanguageModel } from '../ai/fakeLanguageModel'
import { configureApprovals, decide, pendingApprovals, subscribeApprovals } from './approval'
import { explainConnectError, McpManager, serverPrefix } from './manager'

const calls: string[] = []
const server = createMCPServer({
  name: 'notes',
  version: '1.0.0',
  tools: [
    toolDefinition({
      name: 'search_notes',
      description: 'Search notes',
      inputSchema: z.object({ q: z.string() }),
      metadata: { annotations: { readOnlyHint: true } },
    }).server(async ({ q }) => (calls.push(`search:${q}`), { hits: [`note about ${q}`] })),
    toolDefinition({
      name: 'delete_note',
      description: 'Delete a note',
      inputSchema: z.object({ id: z.string() }),
    }).server(async ({ id }) => (calls.push(`delete:${id}`), { deleted: id })),
  ],
})

const row: McpServerRow = {
  id: 'n1',
  name: 'My Notes',
  url: 'http://notes.test/mcp',
  transport: 'http',
  kind: 'remote',
  headers: {},
  enabled: true,
  disabledTools: [],
}

// route the client's HTTP straight into the server — no network
const connect = (s: McpServerRow) =>
  createMCPClient({
    transport: { type: 'http', url: s.url, fetch: (input, init) => server.fetch(new Request(input as string, init)) },
    prefix: serverPrefix(s.name),
  })

describe('McpManager', () => {
  it('lists prefixed tools with read-only hints', async () => {
    const m = new McpManager('web', connect)
    const s = await m.ensure(row)
    expect(s.state).toBe('ready')
    if (s.state !== 'ready') return
    expect(s.tools.map((t) => [t.name, t.readOnly])).toEqual([
      ['my_notes_search_notes', true],
      ['my_notes_delete_note', false],
    ])
  })

  it('reports friendly connection errors', async () => {
    const m = new McpManager('web', async () => {
      throw new TypeError('Failed to fetch')
    })
    const s = await m.ensure(row)
    expect(s.state === 'error' && s.error).toMatch(/CORS/)
    expect(explainConnectError(new TypeError('Failed to fetch'), { kind: 'local' }, 'ext')).toMatch(/bridge/)
    expect(explainConnectError(new Error('HTTP 401'), { kind: 'remote' }, 'ext')).toMatch(/credentials/)
  })

  it('runs read-only tools directly and asks before others, inside a chat turn', async () => {
    calls.length = 0
    configureApprovals([], () => {})
    const m = new McpManager('web', connect)
    const tools = await m.toolsFor({ ...row, disabledTools: [] })

    // approve the destructive call as soon as it is requested
    const off = subscribeApprovals(() => {
      const [p] = pendingApprovals()
      if (p) decide(p.id, 'once')
    })
    installFakeLanguageModel({
      prompts: [
        '{"action":"tool","tool":"my_notes_search_notes","args":{"q":"rust"}}',
        '{"action":"tool","tool":"my_notes_delete_note","args":{"id":"7"}}',
        '{"action":"answer"}',
      ],
      streams: ['Done.'],
    })
    const events: any[] = []
    for await (const e of chat({
      adapter: new ChromeTextAdapter(),
      messages: [{ role: 'user', content: 'find rust notes then delete note 7' }],
      tools,
      agentLoopStrategy: maxIterations(5),
      modelOptions: { conversationId: 'mcp1' },
    }) as AsyncIterable<any>)
      events.push(e)
    off()
    expect(calls).toEqual(['search:rust', 'delete:7'])
    expect(events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta).join('')).toBe('Done.')
  })

  it('respects disabled tools and denials', async () => {
    calls.length = 0
    configureApprovals([], () => {})
    const m = new McpManager('web', connect)
    const tools = await m.toolsFor({ ...row, disabledTools: ['search_notes'] })
    expect(tools.map((t) => t.name)).toEqual(['my_notes_delete_note'])
    const off = subscribeApprovals(() => {
      const [p] = pendingApprovals()
      if (p) decide(p.id, 'deny')
    })
    const run = (tools[0] as any).execute({ id: '1' })
    await expect(run).rejects.toThrow(/declined/)
    off()
    expect(calls).toEqual([])
  })
})

it('does not reconnect a failing server until refreshed', async () => {
  let attempts = 0
  const m = new McpManager('ext', async () => {
    attempts++
    throw new TypeError('Failed to fetch')
  })
  await m.ensure(row)
  await m.ensure(row)
  await m.toolsFor(row)
  expect(attempts).toBe(1)
  await m.refresh(row)
  expect(attempts).toBe(2)
})

it('shares one connection attempt and ignores a stale one after refresh', async () => {
  let attempts = 0
  let releaseFirst: () => void = () => {}
  const m = new McpManager('ext', async (s) => {
    attempts++
    if (attempts === 1) await new Promise<void>((r) => (releaseFirst = r))
    return connect(s)
  })
  const a = m.ensure(row)
  const b = m.ensure(row)
  expect(a).toBe(b) // concurrent callers share the in-flight attempt
  const fresh = m.refresh(row) // user pressed Test while the first is still connecting
  releaseFirst()
  await a
  const s = await fresh
  expect(s.state).toBe('ready')
  expect(m.status(row.id).state).toBe('ready')
  expect(attempts).toBe(2)
  // the new client is kept: no reconnect needed
  await m.ensure(row)
  expect(attempts).toBe(2)
})
