import * as stylex from '@stylexjs/stylex'
import { color, font, radius, space } from '../tokens.stylex'
import { Icon, type IconName } from './Icon'

export interface MentionItem {
  id: string
  label: string
  detail?: string
  icon: IconName
  /** shown instead of picking; the item stays listed */
  unavailable?: string
  /** already chosen for this chat */
  active?: boolean
}

interface Props {
  title: string
  items: MentionItem[]
  index: number
  empty: string
  onPick: (item: MentionItem) => void
  onHover: (i: number) => void
}

/** Suggestion list for "/" (skills) and "@" (tool sources), anchored above the composer. */
export function MentionPicker({ title, items, index, empty, onPick, onHover }: Props) {
  return (
    <div role="listbox" aria-label={title} {...stylex.props(styles.box)}>
      <p {...stylex.props(styles.title)}>{title}</p>
      {items.length === 0 && <p {...stylex.props(styles.empty)}>{empty}</p>}
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === index}
          aria-disabled={!!it.unavailable}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => e.preventDefault()} // keep textarea focus
          onClick={() => onPick(it)}
          {...stylex.props(styles.item, i === index && styles.itemActive, !!it.unavailable && styles.itemOff)}
        >
          <Icon name={it.icon} />
          <span {...stylex.props(styles.text)}>
            <span {...stylex.props(styles.label)}>
              {it.label}
              {it.active && <span {...stylex.props(styles.badge)}>added</span>}
            </span>
            <span {...stylex.props(styles.detail)}>{it.unavailable ?? it.detail}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

const styles = stylex.create({
  box: {
    position: 'absolute',
    insetInline: 0,
    bottom: `calc(100% + ${space.sm})`,
    zIndex: 25,
    maxHeight: '280px',
    overflowY: 'auto',
    padding: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: '0 10px 30px rgba(15, 25, 40, 0.18)',
    fontFamily: font.ui,
  },
  title: { margin: 0, paddingInline: space.sm, paddingBlock: space.xs, fontSize: font.xs, color: color.muted },
  empty: { margin: 0, padding: space.sm, fontSize: font.sm, color: color.muted },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.sm,
    width: '100%',
    textAlign: 'start',
    padding: space.sm,
    borderWidth: 0,
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
    color: color.ink,
    cursor: 'pointer',
  },
  itemActive: { backgroundColor: color.sunken },
  itemOff: { opacity: 0.55, cursor: 'not-allowed' },
  text: { display: 'flex', flexDirection: 'column', gap: space.xxs, minWidth: 0 },
  label: { display: 'flex', alignItems: 'center', gap: space.sm, fontSize: font.sm, fontWeight: 500 },
  detail: {
    fontSize: font.xs,
    color: color.muted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  badge: {
    fontSize: font.xs,
    fontWeight: 400,
    color: color.signal,
  },
})
