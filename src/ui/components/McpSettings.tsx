import * as stylex from '@stylexjs/stylex'
import { useEffect, useReducer, useState } from 'react'
import { db, useDbQuery } from '../../core/db/client'
import type { McpServerRow } from '../../core/db/repo'
import { FEATURES } from '../../core/features'
import { mcp } from '../../core/mcp/instance'
import { serverPrefix } from '../../core/mcp/manager'
import { color, font, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { CopyButton } from './CopyButton'
import { Gated, useFeature } from './Gated'
import { Icon } from './Icon'

const limit = (id: 'mcp-remote' | 'mcp-local' | 'webmcp') => FEATURES.find((f) => f.id === id)!.limitation

export const DEFAULT_BRIDGE_PORT = 8931

/** The stdio→HTTP bridge command for a local server (supergateway, SSE output with CORS). */
export const bridgeCommand = (command: string, port: number) =>
  `npx -y supergateway --stdio ${JSON.stringify(command)} --port ${port} --cors`

type Draft = {
  id?: string
  kind: 'remote' | 'local'
  name: string
  url: string
  transport: 'http' | 'sse'
  command: string
  port: number
  headers: { key: string; value: string }[]
}

const emptyDraft = (kind: Draft['kind']): Draft => ({
  kind,
  name: '',
  url: '',
  transport: 'http',
  command: '',
  port: DEFAULT_BRIDGE_PORT,
  headers: [],
})

function toRow(d: Draft, existing?: McpServerRow): McpServerRow {
  const local = d.kind === 'local'
  return {
    id: d.id ?? crypto.randomUUID(),
    name: d.name.trim() || (local ? 'local' : new URL(d.url).hostname),
    url: local ? `http://localhost:${d.port}/sse` : d.url.trim(),
    transport: local ? 'sse' : d.transport,
    kind: d.kind,
    ...(local ? { command: d.command.trim() } : {}),
    headers: Object.fromEntries(d.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])),
    enabled: existing?.enabled ?? true,
    disabledTools: existing?.disabledTools ?? [],
  }
}

function fromRow(r: McpServerRow): Draft {
  const port = Number(/:(\d+)\//.exec(r.url)?.[1] ?? DEFAULT_BRIDGE_PORT)
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    url: r.url,
    transport: r.transport,
    command: r.command ?? '',
    port,
    headers: Object.entries(r.headers).map(([key, value]) => ({ key, value })),
  }
}

export function McpSettings() {
  const { data: servers = [] } = useDbQuery(() => db.listMcpServers(), [], ['mcp_servers'])
  const [draft, setDraft] = useState<Draft>()
  const [error, setError] = useState<string>()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => mcp.subscribe(bump), [])

  const save = async () => {
    if (!draft) return
    try {
      if (draft.kind === 'remote') new URL(draft.url)
      else if (!draft.command.trim()) throw new Error('Enter the command that starts the MCP server.')
    } catch (e) {
      return setError(e instanceof TypeError ? 'Enter a full URL, like https://example.com/mcp' : (e as Error).message)
    }
    const existing = servers.find((s) => s.id === draft.id)
    const row = toRow(draft, existing)
    await db.saveMcpServer(row)
    setDraft(undefined)
    setError(undefined)
    void mcp.refresh(row)
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <p {...stylex.props(styles.hint)}>
        Connect MCP servers, then add them to a chat by typing <kbd>@</kbd> in the message box. Only the servers you
        pick for a chat use model memory.
      </p>
      <ul {...stylex.props(styles.limits)}>
        <li>
          <strong>Remote:</strong> {limit('mcp-remote')}
        </li>
        <li>
          <strong>Local:</strong> {limit('mcp-local')}
        </li>
        <li>
          <strong>Tool calls:</strong> tools that aren’t marked read-only ask before they run. Results from servers are
          treated as untrusted.
        </li>
      </ul>

      <div {...stylex.props(styles.buttons)}>
        <Gated feature="mcp-remote">
          <Button variant="quiet" icon="plus" onClick={() => setDraft(emptyDraft('remote'))}>
            Add remote server
          </Button>
        </Gated>
        <Gated feature="mcp-local">
          <Button variant="quiet" icon="plus" onClick={() => setDraft(emptyDraft('local'))}>
            Add local server
          </Button>
        </Gated>
      </div>

      {draft && <ServerForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => (setDraft(undefined), setError(undefined))} error={error} />}

      {servers.length === 0 && !draft && <p {...stylex.props(styles.hint)}>No servers yet.</p>}
      <ul {...stylex.props(styles.list)}>
        {servers.map((s) => (
          <ServerItem key={s.id} server={s} onEdit={() => setDraft(fromRow(s))} />
        ))}
      </ul>

      <PageToolsRow />
    </div>
  )
}

function ServerForm({
  draft,
  onChange,
  onSave,
  onCancel,
  error,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  error?: string
}) {
  const [shown, setShown] = useState<number[]>([])
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const local = draft.kind === 'local'
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <label {...stylex.props(styles.field)}>
        <span>Name</span>
        <input value={draft.name} placeholder={local ? 'files' : 'github'} onChange={(e) => set({ name: e.target.value })} {...stylex.props(styles.input)} />
      </label>
      {local ? (
        <>
          <label {...stylex.props(styles.field)}>
            <span>Command that starts the server</span>
            <input
              value={draft.command}
              placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
              onChange={(e) => set({ command: e.target.value })}
              {...stylex.props(styles.input, styles.mono)}
            />
          </label>
          <label {...stylex.props(styles.field)}>
            <span>Bridge port</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={draft.port}
              onChange={(e) => set({ port: Number(e.target.value) })}
              {...stylex.props(styles.input, styles.short)}
            />
          </label>
          <div {...stylex.props(styles.field)}>
            <span>Run this in a terminal and keep it open</span>
            <div {...stylex.props(styles.cmd)}>
              <code {...stylex.props(styles.mono, styles.cmdText)}>{bridgeCommand(draft.command || '<command>', draft.port)}</code>
              <CopyButton text={bridgeCommand(draft.command, draft.port)} label="Copy command" />
            </div>
            <span {...stylex.props(styles.hint)}>
              The bridge runs the server on this machine and exposes it at http://localhost:{draft.port}/sse. Nothing is
              installed by this app.
            </span>
          </div>
        </>
      ) : (
        <>
          <label {...stylex.props(styles.field)}>
            <span>Server URL</span>
            <input
              value={draft.url}
              placeholder="https://example.com/mcp"
              onChange={(e) => set({ url: e.target.value })}
              {...stylex.props(styles.input, styles.mono)}
            />
          </label>
          <label {...stylex.props(styles.field)}>
            <span>Transport</span>
            <select value={draft.transport} onChange={(e) => set({ transport: e.target.value as Draft['transport'] })} {...stylex.props(styles.input, styles.short)}>
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE (older servers)</option>
            </select>
          </label>
        </>
      )}
      <div {...stylex.props(styles.field)}>
        <span>Headers (for example Authorization: Bearer …). Kept only in this browser and never exported.</span>
        {draft.headers.map((h, i) => (
          <div key={i} {...stylex.props(styles.headerRow)}>
            <input
              aria-label="Header name"
              value={h.key}
              placeholder="Authorization"
              onChange={(e) => set({ headers: draft.headers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}
              {...stylex.props(styles.input, styles.mono)}
            />
            <input
              aria-label="Header value"
              type={shown.includes(i) ? 'text' : 'password'}
              autoComplete="off"
              value={h.value}
              placeholder="Bearer …"
              onChange={(e) => set({ headers: draft.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
              {...stylex.props(styles.input, styles.mono)}
            />
            <Button
              icon={shown.includes(i) ? 'eyeOff' : 'eye'}
              label={shown.includes(i) ? 'Hide value' : 'Show value'}
              onClick={() => setShown((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
            />
            <Button icon="x" label="Remove header" onClick={() => set({ headers: draft.headers.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button variant="quiet" icon="plus" onClick={() => set({ headers: [...draft.headers, { key: '', value: '' }] })}>
          Add header
        </Button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(styles.err)}>
          <Icon name="alert" /> {error}
        </p>
      )}
      <div {...stylex.props(styles.buttons)}>
        <Button variant="primary" type="submit">
          Save and connect
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ServerItem({ server, onEdit }: { server: McpServerRow; onEdit: () => void }) {
  const st = mcp.status(server.id)
  const [open, setOpen] = useState(false)
  const toggleTool = (name: string, on: boolean) =>
    db.saveMcpServer({
      ...server,
      disabledTools: on ? server.disabledTools.filter((n) => n !== name) : [...server.disabledTools, name],
    })
  return (
    <li {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.itemHead)}>
        <label {...stylex.props(styles.itemMain)}>
          <input
            type="checkbox"
            checked={server.enabled}
            aria-label={`Enable ${server.name}`}
            onChange={() => db.saveMcpServer({ ...server, enabled: !server.enabled })}
          />
          <span {...stylex.props(styles.itemText)}>
            <span {...stylex.props(styles.name)}>
              <span {...stylex.props(styles.dot, st.state === 'ready' ? styles.ok : st.state === 'error' ? styles.bad : styles.idle)} />
              {server.name} <span {...stylex.props(styles.hint)}>@{serverPrefix(server.name)}</span>
            </span>
            <span {...stylex.props(styles.hint, styles.mono)}>{server.kind === 'local' ? server.command : server.url}</span>
            <span {...stylex.props(st.state === 'error' ? styles.err : styles.hint)}>
              {st.state === 'ready'
                ? `Connected: ${st.tools.length - server.disabledTools.length} of ${st.tools.length} tools on`
                : st.state === 'error'
                  ? st.error
                  : st.state === 'connecting'
                    ? 'Connecting…'
                    : 'Not connected yet'}
            </span>
          </span>
        </label>
        <div {...stylex.props(styles.itemActions)}>
          <Button icon="refresh" label="Test connection" onClick={() => mcp.refresh(server)} />
          <Button icon="edit" label="Edit" onClick={onEdit} />
          <Button
            icon="trash"
            label="Delete"
            onClick={async () => {
              mcp.close(server.id)
              await db.deleteMcpServer(server.id)
            }}
          />
        </div>
      </div>
      {server.kind === 'local' && (
        <div {...stylex.props(styles.cmd)}>
          <code {...stylex.props(styles.mono, styles.cmdText)}>{bridgeCommand(server.command ?? '', Number(/:(\d+)\//.exec(server.url)?.[1]))}</code>
          <CopyButton text={bridgeCommand(server.command ?? '', Number(/:(\d+)\//.exec(server.url)?.[1]))} label="Copy bridge command" />
        </div>
      )}
      {st.state === 'ready' && st.tools.length > 0 && (
        <>
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Hide tools' : `Show ${st.tools.length} tools`}
          </Button>
          {open && (
            <ul {...stylex.props(styles.tools)}>
              {st.tools.map((t) => (
                <li key={t.name}>
                  <label {...stylex.props(styles.itemMain)}>
                    <input
                      type="checkbox"
                      checked={!server.disabledTools.includes(t.remoteName)}
                      onChange={(e) => toggleTool(t.remoteName, e.target.checked)}
                    />
                    <span {...stylex.props(styles.itemText)}>
                      <span>
                        {t.remoteName} {!t.readOnly && <span {...stylex.props(styles.warnTag)}>asks before running</span>}
                      </span>
                      <span {...stylex.props(styles.hint)}>{t.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}

function PageToolsRow() {
  const state = useFeature('webmcp')
  return (
    <div {...stylex.props(styles.item)}>
      <span {...stylex.props(styles.name)}>
        <Icon name="tab" /> Tools from the current page (WebMCP)
      </span>
      <span {...stylex.props(styles.hint)}>{limit('webmcp')}</span>
      <span {...stylex.props(state.available ? styles.hint : styles.warnText)}>
        {state.available ? 'Add them to a chat with @this-tab.' : state.reason}
      </span>
    </div>
  )
}

const styles = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' },
  hint: { margin: 0, color: color.muted, lineHeight: 1.45 },
  limits: {
    margin: 0,
    paddingBlock: space.sm,
    paddingInlineStart: space.xl,
    paddingInlineEnd: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.accent,
  },
  field: { display: 'flex', flexDirection: 'column', gap: space.xs, color: color.ink },
  input: {
    height: size.control,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.bg,
    minWidth: 0,
    flex: 1,
  },
  short: { flex: 'none', width: '180px' },
  mono: { fontFamily: font.mono, fontSize: font.xs },
  headerRow: { display: 'flex', gap: space.xs, alignItems: 'center' },
  cmd: {
    display: 'flex',
    alignItems: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
  },
  cmdText: { flex: 1, overflowWrap: 'anywhere' },
  err: { display: 'flex', gap: space.xs, margin: 0, color: color.danger },
  warnText: { color: color.warn },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.sm },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
  },
  itemHead: { display: 'flex', alignItems: 'flex-start', gap: space.sm },
  itemMain: { display: 'flex', gap: space.sm, flex: 1, minWidth: 0, cursor: 'pointer' },
  itemText: { display: 'flex', flexDirection: 'column', gap: space.xxs, minWidth: 0 },
  itemActions: { display: 'flex' },
  name: { display: 'flex', alignItems: 'center', gap: space.sm, fontWeight: 600 },
  dot: { width: '8px', height: '8px', borderRadius: radius.pill, flexShrink: 0 },
  ok: { backgroundColor: color.signal },
  bad: { backgroundColor: color.danger },
  idle: { backgroundColor: color.line },
  tools: { listStyle: 'none', margin: 0, paddingInlineStart: space.lg, display: 'flex', flexDirection: 'column', gap: space.sm },
  warnTag: { fontSize: font.xs, color: color.warn },
})
