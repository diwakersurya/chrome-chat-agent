import * as stylex from '@stylexjs/stylex'
import type { ContextStats } from '../../core/ai/sessionCache'
import { contextBudget } from '../contextBudget'
import { color, font, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'

/** "Nearly full" and "no longer fits" notices above the composer. */
export function ContextNotices({
  stats,
  overflow,
  onNewChat,
}: {
  stats?: ContextStats
  overflow: boolean
  onNewChat: () => void
}) {
  const budget = stats && contextBudget(stats)
  const text = overflow
    ? 'This chat no longer fits in the model’s memory, so it can’t continue. Start a new chat to keep going.'
    : budget?.level === 'full'
      ? `This chat has used ${budget.pct}% of the model’s memory (${budget.left.toLocaleString()} tokens left). Older messages will be summarized to make room, which can lose detail.`
      : undefined
  if (!text) return null
  return (
    <div role="status" {...stylex.props(styles.notice)}>
      <Icon name="alert" />
      <span {...stylex.props(styles.text)}>{text}</span>
      <Button variant="quiet" icon="plus" onClick={onNewChat}>
        Start new chat
      </Button>
    </div>
  )
}

const styles = stylex.create({
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    marginBottom: space.sm,
    color: color.warn,
    fontFamily: font.ui,
    fontSize: font.sm,
  },
  text: { flex: 1, minWidth: size.notice, lineHeight: 1.4 },
})
