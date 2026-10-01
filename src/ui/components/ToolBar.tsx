import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { decide, pendingApprovals, subscribeApprovals } from '../../core/mcp/approval'
import type { SourceChip } from '../useToolSources'
import { color, font, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'

/** Tool sources active in this chat, plus budget warnings. */
export function SourceChips({
  chips,
  onRemove,
  dropped,
  toolTokens,
}: {
  chips: SourceChip[]
  onRemove: (id: string) => void
  dropped: number
  toolTokens?: number
}) {
  if (!chips.length) return null
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>Tools in this chat</span>
      {chips.map((c) => (
        <span key={c.id} title={c.detail} {...stylex.props(styles.chip)}>
          <StatusDot state={c.status} />
          <span>{c.label}</span>
          <span {...stylex.props(styles.detail)}>{c.status === 'error' ? 'unavailable' : c.detail}</span>
          <Button icon="x" label={`Remove ${c.label} from this chat`} onClick={() => onRemove(c.id)} xstyle={styles.x} />
        </span>
      ))}
      {dropped > 0 && (
        <span role="status" {...stylex.props(styles.warn)}>
          <Icon name="alert" /> {dropped} more tools left out. The model handles at most 12 extra tools; pick fewer sources or
          turn tools off in Settings → Tools.
        </span>
      )}
      {toolTokens != null && toolTokens > 1200 && (
        <span role="status" {...stylex.props(styles.warn)}>
          <Icon name="alert" /> Tool descriptions use about {toolTokens.toLocaleString()} tokens of model memory per
          message.
        </span>
      )}
    </div>
  )
}

const snapshot = () => pendingApprovals()
let cache = snapshot()
const getSnapshot = () => cache
const subscribe = (fn: () => void) =>
  subscribeApprovals(() => {
    cache = snapshot()
    fn()
  })

/** Pending tool calls that need the user's OK before they run. */
export function ApprovalCards() {
  const pending = useSyncExternalStore(subscribe, getSnapshot)
  const allowRef = useRef<HTMLButtonElement>(null)
  const first = pending[0]?.id
  // the reply is waiting on the user: move focus to the decision
  useEffect(() => {
    if (!first) return
    allowRef.current?.focus()
    allowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [first])
  if (!pending.length) return null
  return (
    <div {...stylex.props(styles.cards)}>
      {pending.map((p, i) => (
        <div
          key={p.id}
          role="alertdialog"
          aria-label={`Allow ${p.tool} from ${p.source}?`}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), decide(p.id, 'deny'))}
          {...stylex.props(styles.card)}
        >
          <p {...stylex.props(styles.cardTitle)}>
            <Icon name="plug" /> Allow <strong>{p.tool}</strong> from {p.source}?
          </p>
          <p {...stylex.props(styles.cardHint)}>This tool isn’t marked read-only, so it may change something outside this app.</p>
          <pre {...stylex.props(styles.args)}>{JSON.stringify(p.args, null, 2)}</pre>
          <div {...stylex.props(styles.actions)}>
            <Button ref={i === 0 ? allowRef : undefined} variant="primary" onClick={() => decide(p.id, 'once')}>
              Allow once
            </Button>
            <Button variant="quiet" onClick={() => decide(p.id, 'always')}>
              Always allow this tool
            </Button>
            <Button variant="danger" onClick={() => decide(p.id, 'deny')}>
              Deny (Esc)
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
    fontFamily: font.ui,
    fontSize: font.xs,
  },
  label: { color: color.muted },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    height: size.control,
    paddingInlineStart: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.surface,
    color: color.ink,
  },
  detail: { color: color.muted },
  x: { borderRadius: radius.pill },
  warn: { display: 'inline-flex', alignItems: 'center', gap: space.xs, color: color.warn },
  cards: { display: 'flex', flexDirection: 'column', gap: space.sm, marginBottom: space.sm },
  card: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.warn,
    backgroundColor: color.surface,
    fontFamily: font.ui,
    fontSize: font.sm,
    color: color.ink,
  },
  cardTitle: { display: 'flex', alignItems: 'center', gap: space.sm, margin: 0 },
  cardHint: { margin: 0, marginTop: space.xs, color: color.muted, fontSize: font.xs },
  args: {
    marginBlock: space.sm,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    fontFamily: font.mono,
    fontSize: font.xs,
    maxHeight: size.notice,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
})
