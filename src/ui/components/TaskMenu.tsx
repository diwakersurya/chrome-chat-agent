import * as stylex from '@stylexjs/stylex'
import { useId } from 'react'
import { color, font, radius, shadow, size, space } from '../tokens.stylex'
import { Icon } from './Icon'
import { TASK_LABELS, type TaskId } from '../tasks'

export type { TaskId } from '../tasks'

// Native popover API: no positioning library, light-dismiss for free.
export function TaskMenu({ tasks, disabled, onPick }: { tasks: TaskId[]; disabled?: boolean; onPick: (t: TaskId) => void }) {
  const id = useId()
  const anchor = `--task-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        disabled={disabled}
        title="Transform with Chrome AI"
        aria-label="Transform with Chrome AI"
        {...stylex.props(styles.trigger, styles.anchor(anchor))}
      >
        <Icon name="wand" />
      </button>
      <div id={id} popover="auto" role="menu" {...stylex.props(styles.menu, styles.anchored(anchor))}>
        {tasks.map((t) => (
          <button
            key={t}
            type="button"
            role="menuitem"
            {...stylex.props(styles.item)}
            onClick={(e) => {
              ;(e.currentTarget.parentElement as HTMLElement).hidePopover()
              onPick(t)
            }}
          >
            {TASK_LABELS[t]}
          </button>
        ))}
      </div>
    </>
  )
}

const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size.control,
    height: size.control,
    borderRadius: radius.md,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover:not(:disabled)': color.sunken },
    color: { default: color.muted, ':hover': color.ink },
    cursor: 'pointer',
  },
  anchor: (name: string) => ({ anchorName: name }),
  anchored: (name: string) => ({ positionAnchor: name }),
  menu: {
    margin: 0,
    padding: space.xs,
    minWidth: size.menu,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    color: color.ink,
    boxShadow: shadow.popover,
    top: 'anchor(bottom)',
    left: 'anchor(left)',
    positionTryFallbacks: 'flip-block, flip-inline',
  },
  item: {
    display: 'block',
    width: '100%',
    textAlign: 'start',
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderWidth: 0,
    borderRadius: radius.sm,
    backgroundColor: { default: 'transparent', ':hover': color.sunken, ':focus-visible': color.sunken },
    fontFamily: font.ui,
    fontSize: font.sm,
    cursor: 'pointer',
  },
})
