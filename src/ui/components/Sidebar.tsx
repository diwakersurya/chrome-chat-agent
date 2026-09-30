import * as stylex from '@stylexjs/stylex'
import { useDeferredValue, useState } from 'react'
import { db, useDbQuery } from '../../core/db/client'
import type { ConversationRow } from '../../core/db/repo'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'

interface Props {
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (c: ConversationRow) => void
  searchRef: React.RefObject<HTMLInputElement | null>
}

const DAY = 86_400_000

function groupByDate(rows: ConversationRow[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const groups: [string, ConversationRow[]][] = [
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []],
  ]
  for (const r of rows) {
    const i = r.updatedAt >= startOfToday ? 0 : r.updatedAt >= startOfToday - DAY ? 1 : r.updatedAt >= startOfToday - 7 * DAY ? 2 : 3
    groups[i]![1].push(r)
  }
  return groups.filter(([, list]) => list.length)
}

export function Sidebar({ activeId, onSelect, onNew, onDelete, searchRef }: Props) {
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const { data: rows = [] } = useDbQuery(() => db.listConversations(), [], ['conversations'])
  const { data: hits } = useDbQuery(() => (q ? db.search(q) : Promise.resolve(undefined)), [q], ['messages', 'conversations'])

  return (
    <nav aria-label="Conversations" {...stylex.props(styles.nav)}>
      <div {...stylex.props(styles.top)}>
        <Button icon="plus" variant="quiet" onClick={onNew} xstyle={styles.newBtn}>
          New chat
        </Button>
        <label {...stylex.props(styles.search)}>
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search chats"
            {...stylex.props(styles.searchInput)}
          />
        </label>
      </div>

      <div {...stylex.props(styles.list)}>
        {hits ? (
          hits.length ? (
            <ul {...stylex.props(styles.ul)}>
              {hits.map((h) => (
                <li key={h.conversationId}>
                  <button type="button" onClick={() => onSelect(h.conversationId)} {...stylex.props(styles.hit)}>
                    <span {...stylex.props(styles.title)}>{h.title}</span>
                    {h.snippet && <Snippet text={h.snippet} />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p {...stylex.props(styles.empty)}>No chats match “{q}”.</p>
          )
        ) : rows.length ? (
          groupByDate(rows).map(([label, list]) => (
            <section key={label} aria-label={label}>
              <h2 {...stylex.props(styles.group)}>{label}</h2>
              <ul {...stylex.props(styles.ul)}>
                {list.map((c) => (
                  <ConversationItem
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    onSelect={() => onSelect(c.id)}
                    onDelete={() => onDelete(c)}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p {...stylex.props(styles.empty)}>Your chats will appear here.</p>
        )}
      </div>
    </nav>
  )
}

/** FTS snippet uses «…» as match markers. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/«|»/)
  return (
    <span {...stylex.props(styles.snippet)}>
      {parts.map((p, i) => (i % 2 ? <mark key={i} {...stylex.props(styles.mark)}>{p}</mark> : p))}
    </span>
  )
}

function ConversationItem({
  c,
  active,
  onSelect,
  onDelete,
}: {
  c: ConversationRow
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(c.title)

  const commit = () => {
    setEditing(false)
    const t = title.trim()
    if (t && t !== c.title) void db.renameConversation(c.id, t)
    else setTitle(c.title)
  }

  return (
    <li {...stylex.props(styles.item, active && styles.itemActive)}>
      {editing ? (
        <input
          autoFocus
          value={title}
          aria-label="Chat title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') (setTitle(c.title), setEditing(false))
          }}
          {...stylex.props(styles.rename)}
        />
      ) : (
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          {...stylex.props(styles.itemBtn)}
        >
          <span {...stylex.props(styles.title)}>{c.title}</span>
        </button>
      )}
      {!editing && (
        <div {...stylex.props(styles.itemActions)}>
          <Button icon="edit" label="Rename" onClick={() => setEditing(true)} />
          <Button icon="trash" label="Delete" onClick={onDelete} />
        </div>
      )}
    </li>
  )
}

const styles = stylex.create({
  nav: {
    display: 'flex',
    flexDirection: 'column',
    width: size.sidebar,
    height: '100%',
    backgroundColor: color.bg,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.line,
    fontFamily: font.ui,
  },
  top: { display: 'flex', flexDirection: 'column', gap: space.sm, padding: space.md },
  newBtn: { justifyContent: 'flex-start' },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    height: size.control,
    paddingInline: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.sunken,
    color: color.muted,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: font.sm,
    color: color.ink,
  },
  list: { flex: 1, overflowY: 'auto', paddingInline: space.sm, paddingBottom: space.lg },
  ul: { listStyle: 'none', margin: 0, padding: 0 },
  group: {
    margin: 0,
    paddingInline: space.sm,
    paddingTop: space.md,
    paddingBottom: space.xs,
    fontSize: font.xs,
    fontWeight: 500,
    color: color.muted,
  },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.sunken },
    transitionProperty: 'background-color',
    transitionDuration: motion.fast,
  },
  itemActive: { backgroundColor: color.sunken },
  itemBtn: {
    flex: 1,
    minWidth: 0,
    textAlign: 'start',
    paddingInline: space.sm,
    paddingBlock: space.sm,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: font.sm,
    color: color.ink,
  },
  title: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemActions: {
    display: 'flex',
    opacity: { default: 0, ':hover': 1, ':focus-within': 1 },
    transitionProperty: 'opacity',
    transitionDuration: motion.fast,
  },
  rename: {
    flex: 1,
    minWidth: 0,
    margin: space.xxs,
    paddingInline: space.sm,
    height: size.control,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.accent,
    backgroundColor: color.surface,
    fontSize: font.sm,
  },
  hit: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xxs,
    width: '100%',
    textAlign: 'start',
    padding: space.sm,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.sunken },
    cursor: 'pointer',
    fontSize: font.sm,
    color: color.ink,
  },
  snippet: { fontSize: font.xs, color: color.muted, lineHeight: 1.4 },
  mark: { backgroundColor: 'transparent', color: color.accent, fontWeight: 600 },
  empty: { paddingInline: space.sm, fontSize: font.sm, color: color.muted },
})
