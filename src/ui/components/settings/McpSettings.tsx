import * as stylex from '@stylexjs/stylex'
import { useEffect, useReducer, useState } from 'react'
import { db, useDbQuery } from '../../../core/db/client'
import type { McpServerRow } from '../../../core/db/repo'
import { FEATURES } from '../../../core/features'
import { mcp } from '../../../core/mcp/instance'
import { useToast } from '../../toast'
import { space } from '../../tokens.stylex'
import { Button } from '../Button'
import { Gated, useFeature } from '../Gated'
import { Icon } from '../Icon'
import { emptyDraft, fromRow, toRow, validateDraft, type ServerDraft } from './mcpDraft'
import { ServerForm } from './ServerForm'
import { ServerItem } from './ServerItem'
import { s } from './styles'

const limit = (id: 'mcp-remote' | 'mcp-local' | 'webmcp') => FEATURES.find((f) => f.id === id)!.limitation

/** Settings → Tools: MCP servers and page tools. */
export function McpSettings() {
  const { data } = useDbQuery(() => db.listMcpServers(), [], ['mcp_servers'])
  const servers = data ?? []
  const toast = useToast()
  const [draft, setDraft] = useState<ServerDraft>()
  const [error, setError] = useState<string>()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => mcp.subscribe(bump), [])

  const save = async () => {
    if (!draft) return
    const problem = validateDraft(draft)
    if (problem) return setError(problem)
    const row = toRow(draft, servers.find((x) => x.id === draft.id))
    await db.saveMcpServer(row)
    setDraft(undefined)
    setError(undefined)
    void mcp.refresh(row)
  }

  const remove = async (server: McpServerRow) => {
    mcp.close(server.id)
    await db.deleteMcpServer(server.id)
    toast.show({ text: `Removed “${server.name}”`, action: { label: 'Undo', run: () => void db.saveMcpServer(server) } })
  }

  return (
    <div {...stylex.props(s.stack)}>
      <p {...stylex.props(s.hint)}>
        MCP servers are small programs that give the model extra tools, like reading your files or working with GitHub.
        Connect them here, then add one to a chat by typing <kbd>@</kbd> in the message box. Only the servers you add to a
        chat use model memory.
      </p>
      <details open {...stylex.props(styles.limits)}>
        <summary {...stylex.props(styles.summary)}>
          <Icon name="info" /> What to know before you connect
        </summary>
        <ul {...stylex.props(styles.limitList)}>
          <li>
            <strong>Remote servers:</strong> {limit('mcp-remote')}
          </li>
          <li>
            <strong>Local servers:</strong> {limit('mcp-local')}
          </li>
          <li>
            <strong>Tool calls:</strong> tools that aren’t marked read-only ask before they run. What servers send back is
            treated as untrusted.
          </li>
        </ul>
      </details>

      <div {...stylex.props(s.buttons)}>
        <Gated feature="mcp-remote">
          <Button variant="quiet" icon="plus" onClick={() => (setDraft(emptyDraft('remote')), setError(undefined))}>
            Add remote server
          </Button>
        </Gated>
        <Gated feature="mcp-local">
          <Button variant="quiet" icon="plus" onClick={() => (setDraft(emptyDraft('local')), setError(undefined))}>
            Add local server
          </Button>
        </Gated>
      </div>

      {draft && (
        <ServerForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => (setDraft(undefined), setError(undefined))} error={error} />
      )}

      {servers.length === 0 && !draft && <p {...stylex.props(s.hint)}>No servers yet.</p>}
      <ul {...stylex.props(s.list)}>
        {servers.map((x) => (
          <ServerItem key={x.id} server={x} onEdit={() => setDraft(fromRow(x))} onDelete={() => remove(x)} />
        ))}
      </ul>

      <PageToolsRow />
    </div>
  )
}

function PageToolsRow() {
  const state = useFeature('webmcp')
  return (
    <div {...stylex.props(s.item)}>
      <span {...stylex.props(s.name)}>
        <Icon name="tab" /> Tools from the current page (WebMCP)
      </span>
      <span {...stylex.props(s.hint)}>Some websites offer tools the model can use while you’re on them. {limit('webmcp')}</span>
      <span {...stylex.props(state.available ? s.hint : s.warn)}>
        {state.available ? 'Add them to a chat with @this-tab.' : state.reason}
      </span>
    </div>
  )
}

const styles = stylex.create({
  limits: { width: '100%' },
  summary: { display: 'flex', alignItems: 'center', gap: space.sm, cursor: 'pointer', fontWeight: 500 },
  limitList: {
    marginBlock: space.sm,
    paddingBlock: space.sm,
    paddingInlineStart: space.xl,
    paddingInlineEnd: space.sm,
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  },
})
