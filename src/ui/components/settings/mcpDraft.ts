import type { McpServerRow } from '../../../core/db/repo'

export const DEFAULT_BRIDGE_PORT = 8931

/**
 * The stdio→HTTP bridge command for a local server (supergateway, SSE output).
 * CORS is limited to this app's origin so other websites can't drive the server.
 */
export const bridgeCommand = (command: string, port: number, origin: string) =>
  `npx -y supergateway --stdio ${JSON.stringify(command)} --port ${port} --cors ${JSON.stringify(origin)}`

/** Port of a bridge URL like http://localhost:8931/sse. */
export function portOf(url: string) {
  try {
    const p = Number(new URL(url).port)
    return Number.isInteger(p) && p > 0 ? p : DEFAULT_BRIDGE_PORT
  } catch {
    return DEFAULT_BRIDGE_PORT
  }
}

export type ServerDraft = {
  id?: string
  kind: 'remote' | 'local'
  name: string
  url: string
  transport: 'http' | 'sse'
  command: string
  port: number
  headers: { key: string; value: string }[]
}

export const emptyDraft = (kind: ServerDraft['kind']): ServerDraft => ({
  kind,
  name: '',
  url: '',
  transport: 'http',
  command: '',
  port: DEFAULT_BRIDGE_PORT,
  headers: [],
})

/** Validate a draft; returns a message for the user or undefined when it can be saved. */
export function validateDraft(d: ServerDraft): string | undefined {
  if (d.kind === 'local') {
    if (!d.command.trim()) return 'Enter the command that starts the MCP server.'
    if (!Number.isInteger(d.port) || d.port < 1024 || d.port > 65535) return 'Pick a port between 1024 and 65535.'
    return undefined
  }
  try {
    const u = new URL(d.url.trim())
    if (!/^https?:$/.test(u.protocol)) return 'The URL must start with http:// or https://'
  } catch {
    return 'Enter a full URL, like https://example.com/mcp'
  }
  return undefined
}

export function toRow(d: ServerDraft, existing?: McpServerRow): McpServerRow {
  const local = d.kind === 'local'
  return {
    id: d.id ?? crypto.randomUUID(),
    name: d.name.trim() || (local ? 'local' : new URL(d.url.trim()).hostname),
    url: local ? `http://localhost:${d.port}/sse` : d.url.trim(),
    transport: local ? 'sse' : d.transport,
    kind: d.kind,
    ...(local ? { command: d.command.trim() } : {}),
    headers: Object.fromEntries(d.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])),
    enabled: existing?.enabled ?? true,
    disabledTools: existing?.disabledTools ?? [],
  }
}

export function fromRow(r: McpServerRow): ServerDraft {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    url: r.url,
    transport: r.transport,
    command: r.command ?? '',
    port: portOf(r.url),
    headers: Object.entries(r.headers).map(([key, value]) => ({ key, value })),
  }
}
