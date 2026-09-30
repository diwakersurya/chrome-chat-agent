// Dev-only MCP server (Streamable HTTP, permissive CORS) for trying MCP in the app: bun run mcp:test
import { toolDefinition } from '@tanstack/ai'
import { createMCPServer } from '@tanstack/ai-mcp/server'
import { z } from 'zod'

const notes = new Map([['1', 'Buy oat milk'], ['2', 'Call the dentist on Friday']])
const server = createMCPServer({
  name: 'notes',
  version: '1.0.0',
  tools: [
    toolDefinition({
      name: 'list_notes',
      description: 'List all notes with their ids',
      inputSchema: z.object({}),
      metadata: { annotations: { readOnlyHint: true } },
    }).server(async () => ({ notes: [...notes].map(([id, text]) => ({ id, text })) })),
    toolDefinition({
      name: 'add_note',
      description: 'Add a new note',
      inputSchema: z.object({ text: z.string() }),
    }).server(async ({ text }) => {
      const id = String(notes.size + 1)
      notes.set(id, text)
      console.error('ADDED', id, text)
      return { id, text }
    }),
  ],
})

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
}
Bun.serve({
  port: 8940,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    const res = await server.fetch(req)
    const h = new Headers(res.headers)
    for (const [k, v] of Object.entries(cors)) h.set(k, v)
    return new Response(res.body, { status: res.status, headers: h })
  },
})
console.error('MCP test server on http://localhost:8940/mcp')
