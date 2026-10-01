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
  const { data: rows } = useDbQuery(() => db.listConversations(), [], ['conversations'])
  const { data: found } = useDbQuery(
    () => (q ? db.search(q).then((hits) => ({ q, hits })) : Promise.resolve(undefined)),
    [q],
    ['messages', 'conversations'],
  )
  // only show results for the current query; anything else is still searching
  const searching = !!query.trim() && found?.q !== query.trim()
  const hits = query.trim() && !searching ? found?.hits : undefined

  return (
    <nav aria-label="Conversations" {...stylex.props(styles.nav)}>
      <div {...stylex.props(styles.top)}>
        <Button icon="plus" variant="quiet" title="New chat (⌘⇧O)" onClick={onNew} xstyle={styles.newBtn}>
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
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
            aria-label="Search chats (⌘K)"
            {...stylex.props(styles.searchInput)}
          />
        </label>
      </div>

      <div {...stylex.props(styles.list)} aria-busy={!rows || searching}>
        {searching ? (
          <p role="status" {...stylex.props(styles.empty)}>
            Searching…
          </p>
        ) : hits ? (
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
        ) : !rows ? (
          <RowSkeletons />
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

/** Placeholder rows sized like real ones, so the list doesn't jump when chats load. */
function RowSkeletons() {
  return (
    <ul aria-hidden {...stylex.props(styles.ul)}>
      {[72, 54, 64, 40].map((w) => (
        <li key={w} {...stylex.props(styles.skeletonRow)}>
          <span {...stylex.props(styles.bone, styles.boneW(w))} />
        </li>
      ))}
    </ul>
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
  // actions show on row hover/focus and always on the active row and on touch screens
  const [hot, setHot] = useState(false)

  const commit = () => {
    setEditing(false)
    const t = title.trim()
    if (t && t !== c.title) void db.renameConversation(c.id, t)
    else setTitle(c.title)
  }

  return (
    <li
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHot(false)}
      {...stylex.props(styles.item, active && styles.itemActive)}
    >
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
          title={c.title}
          {...stylex.props(styles.itemBtn)}
        >
          <span {...stylex.props(styles.title)}>{c.title}</span>
        </button>
      )}
      {!editing && (
        <div {...stylex.props(styles.itemActions, (hot || active) && styles.itemActionsOn)}>
          <Button icon="edit" label="Rename" onClick={() => setEditing(true)} />
          <Button icon="trash" label="Delete" onClick={onDelete} />
        </div>
      )}
    </li>
  )
}

const shimmer = stylex.keyframes({ '0%': { opacity: 0.35 }, '50%': { opacity: 0.8 }, '100%': { opacity: 0.35 } })

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
    opacity: { default: 0, '@media (hover: none)': 1 },
    transitionProperty: 'opacity',
    transitionDuration: motion.fast,
  },
  itemActionsOn: { opacity: 1 },
  skeletonRow: { display: 'flex', alignItems: 'center', height: size.control, paddingInline: space.sm, marginBlock: space.xxs },
  bone: {
    display: 'block',
    height: '0.9em',
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    animationName: shimmer,
    animationDuration: motion.loop,
    animationIterationCount: 'infinite',
  },
  boneW: (pct: number) => ({ width: `${pct}%` }),
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
