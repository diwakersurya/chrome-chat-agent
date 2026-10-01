import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { color, radius, space } from '../../tokens.stylex'
import { Button } from '../Button'
import { CopyButton } from '../CopyButton'
import { Icon } from '../Icon'
import { bridgeCommand, type ServerDraft } from './mcpDraft'
import { s } from './styles'

interface Props {
  draft: ServerDraft
  onChange: (d: ServerDraft) => void
  onSave: () => void
  onCancel: () => void
  error?: string
}

/** Add or edit an MCP server. Secrets are masked by default with an eye toggle. */
export function ServerForm({ draft, onChange, onSave, onCancel, error }: Props) {
  const [shown, setShown] = useState<number[]>([])
  const set = (patch: Partial<ServerDraft>) => onChange({ ...draft, ...patch })
  const local = draft.kind === 'local'
  const setHeader = (i: number, patch: Partial<ServerDraft['headers'][number]>) =>
    set({ headers: draft.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) })

  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <label {...stylex.props(s.field)}>
        <span>Name</span>
        <input autoFocus value={draft.name} placeholder={local ? 'files' : 'github'} onChange={(e) => set({ name: e.target.value })} {...stylex.props(s.input)} />
      </label>
      {local ? (
        <>
          <label {...stylex.props(s.field)}>
            <span>Command that starts the server</span>
            <input
              value={draft.command}
              placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
              onChange={(e) => set({ command: e.target.value })}
              {...stylex.props(s.input, s.mono)}
            />
          </label>
          <label {...stylex.props(s.field)}>
            <span>Port for the bridge</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={draft.port}
              onChange={(e) => set({ port: Number(e.target.value) })}
              {...stylex.props(s.input, s.short)}
            />
          </label>
          <div {...stylex.props(s.field)}>
            <span>Run this in a terminal and keep it open</span>
            <div {...stylex.props(styles.cmd)}>
              <code {...stylex.props(s.mono, styles.cmdText)}>{bridgeCommand(draft.command || '<command>', draft.port, location.origin)}</code>
              <CopyButton text={bridgeCommand(draft.command, draft.port, location.origin)} label="Copy command" />
            </div>
            <span {...stylex.props(s.hint)}>
              A browser can’t start programs, so this small bridge starts the server for you and makes it reachable at
              http://localhost:{draft.port}/sse, for this app only. This app installs nothing.
            </span>
          </div>
        </>
      ) : (
        <>
          <label {...stylex.props(s.field)}>
            <span>Server URL</span>
            <input
              value={draft.url}
              placeholder="https://example.com/mcp"
              inputMode="url"
              onChange={(e) => set({ url: e.target.value })}
              {...stylex.props(s.input, s.mono)}
            />
          </label>
          <label {...stylex.props(s.field)}>
            <span>Connection type</span>
            <select value={draft.transport} onChange={(e) => set({ transport: e.target.value as ServerDraft['transport'] })} {...stylex.props(s.input, s.short)}>
              <option value="http">Streamable HTTP (recommended)</option>
              <option value="sse">SSE (older servers)</option>
            </select>
          </label>
        </>
      )}
      <div {...stylex.props(s.field)}>
        <span>Headers, for example Authorization: Bearer … They stay in this browser and are never exported.</span>
        {draft.headers.map((h, i) => (
          <div key={i} {...stylex.props(styles.headerRow)}>
            <input aria-label="Header name" value={h.key} placeholder="Authorization" onChange={(e) => setHeader(i, { key: e.target.value })} {...stylex.props(s.input, s.mono)} />
            <input
              aria-label="Header value"
              type={shown.includes(i) ? 'text' : 'password'}
              autoComplete="off"
              value={h.value}
              placeholder="Bearer …"
              onChange={(e) => setHeader(i, { value: e.target.value })}
              {...stylex.props(s.input, s.mono)}
            />
            <Button
              icon={shown.includes(i) ? 'eyeOff' : 'eye'}
              label={shown.includes(i) ? 'Hide value' : 'Show value'}
              onClick={() => setShown((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}
            />
            <Button icon="x" label="Remove header" onClick={() => set({ headers: draft.headers.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button variant="quiet" icon="plus" onClick={() => set({ headers: [...draft.headers, { key: '', value: '' }] })}>
          Add header
        </Button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(s.err)}>
          <Icon name="alert" /> {error}
        </p>
      )}
      <div {...stylex.props(s.buttons)}>
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

const styles = stylex.create({
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
})
