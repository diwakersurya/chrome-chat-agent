import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { db } from '../../../core/db/client'
import type { McpServerRow } from '../../../core/db/repo'
import { mcp } from '../../../core/mcp/instance'
import { serverPrefix } from '../../../core/mcp/manager'
import { color, font, radius, space } from '../../tokens.stylex'
import { Button } from '../Button'
import { CopyButton } from '../CopyButton'
import { StatusDot } from '../StatusDot'
import { bridgeCommand, portOf } from './mcpDraft'
import { s } from './styles'

interface Props {
  server: McpServerRow
  onEdit: () => void
  onDelete: () => void
}

/** One configured server: status, actions, bridge command and per-tool switches. */
export function ServerItem({ server, onEdit, onDelete }: Props) {
  const st = mcp.status(server.id)
  const [open, setOpen] = useState(false)
  const toggleTool = (name: string, on: boolean) =>
    db.saveMcpServer({
      ...server,
      disabledTools: on ? server.disabledTools.filter((n) => n !== name) : [...server.disabledTools, name],
    })
  const statusLine =
    st.state === 'ready'
      ? `Connected: ${st.tools.length - server.disabledTools.length} of ${st.tools.length} tools on`
      : st.state === 'error'
        ? st.error
        : st.state === 'connecting'
          ? 'Connecting…'
          : 'Not connected yet. It connects when you add it to a chat, or press Test.'
  const command = bridgeCommand(server.command ?? '', portOf(server.url), location.origin)

  return (
    <li {...stylex.props(s.item)}>
      <div {...stylex.props(s.itemHead)}>
        <label {...stylex.props(s.itemMain)}>
          <input
            type="checkbox"
            checked={server.enabled}
            aria-label={`Use ${server.name}`}
            onChange={() => db.saveMcpServer({ ...server, enabled: !server.enabled })}
          />
          <span {...stylex.props(s.itemText)}>
            <span {...stylex.props(s.name)}>
              <StatusDot state={st.state === 'ready' ? 'ready' : st.state === 'error' ? 'error' : st.state === 'connecting' ? 'connecting' : 'idle'} />
              {server.name} <span {...stylex.props(s.hint)}>@{serverPrefix(server.name)}</span>
            </span>
            <span {...stylex.props(s.hint, s.mono, styles.wrap)}>{server.kind === 'local' ? server.command : server.url}</span>
            <span role="status" {...stylex.props(st.state === 'error' ? s.err : s.hint)}>
              {statusLine}
            </span>
          </span>
        </label>
        <div {...stylex.props(s.itemActions)}>
          <Button icon="refresh" label="Test connection" onClick={() => mcp.refresh(server)} />
          <Button icon="edit" label="Edit" onClick={onEdit} />
          <Button icon="trash" label="Delete" onClick={onDelete} />
        </div>
      </div>
      {server.kind === 'local' && (
        <div {...stylex.props(styles.cmd)}>
          <code {...stylex.props(s.mono, styles.wrap, styles.grow)}>{command}</code>
          <CopyButton text={command} label="Copy bridge command" />
        </div>
      )}
      {st.state === 'ready' && st.tools.length > 0 && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} {...stylex.props(styles.disclosure)}>
            {open ? 'Hide tools' : `Show ${st.tools.length} tools`}
          </button>
          {open && (
            <ul {...stylex.props(styles.tools)}>
              {st.tools.map((t) => (
                <li key={t.name}>
                  <label {...stylex.props(s.itemMain)}>
                    <input type="checkbox" checked={!server.disabledTools.includes(t.remoteName)} onChange={(e) => toggleTool(t.remoteName, e.target.checked)} />
                    <span {...stylex.props(s.itemText)}>
                      <span>
                        {t.remoteName} {!t.readOnly && <span {...stylex.props(styles.warnTag)}>asks before running</span>}
                      </span>
                      <span {...stylex.props(s.hint)}>{t.description}</span>
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

const styles = stylex.create({
  wrap: { overflowWrap: 'anywhere' },
  grow: { flex: 1 },
  cmd: {
    display: 'flex',
    alignItems: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
  },
  disclosure: {
    alignSelf: 'flex-start',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: color.accent,
    fontFamily: font.ui,
    fontSize: font.sm,
    cursor: 'pointer',
    textDecoration: { default: 'none', ':hover': 'underline' },
  },
  tools: { listStyle: 'none', margin: 0, paddingInlineStart: space.lg, display: 'flex', flexDirection: 'column', gap: space.sm },
  warnTag: { fontSize: font.xs, color: color.warn },
})
