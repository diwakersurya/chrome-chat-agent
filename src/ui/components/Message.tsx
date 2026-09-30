import * as stylex from '@stylexjs/stylex'
import type { UIMessage } from '@tanstack/ai-react'
import { memo, useState } from 'react'
import { parsePageContext } from '../pageContext'
import { parseSkillPart } from '../../core/skills/skills'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { CopyButton } from './CopyButton'
import { Gated, useFeature } from './Gated'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { TaskMenu, type TaskId } from './TaskMenu'

export function messageText(m: UIMessage) {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { content: string }).content)
    .filter((t) => !parsePageContext(t) && !parseSkillPart(t))
    .join('\n\n')
}

interface Props {
  message: UIMessage
  streaming: boolean
  busy: boolean
  tasks: TaskId[]
  onEdit: (id: string, text: string) => void
  onRegenerate: (id: string) => void
  onTask: (id: string, task: TaskId) => void
}

export const Message = memo(function Message({ message, streaming, busy, tasks, onEdit, onRegenerate, onTask }: Props) {
  const [editing, setEditing] = useState(false)
  const tasksOk = useFeature('tasks').available && tasks.length > 0
  const isUser = message.role === 'user'
  const text = messageText(message)
  const taskLabel = (message.metadata as { task?: string } | undefined)?.task
  const results = new Map(
    message.parts.filter((p) => p.type === 'tool-result').map((p: any) => [p.toolCallId, p]),
  )

  if (editing) {
    return <EditBox initial={text} onCancel={() => setEditing(false)} onSave={(t) => (setEditing(false), onEdit(message.id, t))} />
  }

  return (
    <article {...stylex.props(styles.row, isUser && styles.rowUser)} aria-label={isUser ? 'You' : 'Assistant'}>
      <div {...stylex.props(isUser ? styles.user : styles.assistant)}>
        {taskLabel && <p {...stylex.props(styles.taskTag)}>{taskLabel}</p>}
        {message.parts.map((part: any, i) => {
          switch (part.type) {
            case 'text': {
              const page = parsePageContext(part.content)
              if (page) return <PageChip key={i} title={page.title} url={page.url} />
              const skill = parseSkillPart(part.content)
              if (skill)
                return (
                  <span key={i} {...stylex.props(styles.chip)}>
                    <Icon name="book" />
                    <span {...stylex.props(styles.chipText)}>/{skill.name}</span>
                  </span>
                )
              return isUser ? (
                <p key={i} {...stylex.props(styles.userText)}>
                  {part.content}
                </p>
              ) : (
                <Markdown key={i} text={part.content} />
              )
            }
            case 'image':
              return (
                <img
                  key={i}
                  alt="Attached image"
                  src={srcOf(part.source)}
                  {...stylex.props(styles.media)}
                />
              )
            case 'audio':
              return <audio key={i} controls src={srcOf(part.source)} {...stylex.props(styles.audio)} />
            case 'tool-call':
              return <ToolRow key={i} name={part.name} args={part.arguments} result={results.get(part.id)} output={part.output} />
            default:
              return null
          }
        })}
        {streaming && <span {...stylex.props(styles.caret)} aria-hidden />}
      </div>
      {!streaming && text && (
        <div {...stylex.props(styles.actions, isUser && styles.actionsUser)}>
          <CopyButton text={text} label="Copy message" />
          {isUser ? (
            <Button icon="edit" label="Edit and resend" disabled={busy} onClick={() => setEditing(true)} />
          ) : (
            !taskLabel && <Button icon="refresh" label="Regenerate" disabled={busy} onClick={() => onRegenerate(message.id)} />
          )}
          {tasksOk ? (
            <TaskMenu tasks={tasks} disabled={busy} onPick={(t) => onTask(message.id, t)} />
          ) : (
            <Gated feature="tasks">
              <Button icon="wand" label="Transform with Chrome AI" />
            </Gated>
          )}
        </div>
      )}
    </article>
  )
})

const srcOf = (s: any) => (s.type === 'data' ? `data:${s.mimeType};base64,${s.value}` : s.value)

function PageChip({ title, url }: { title: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" title={url} {...stylex.props(styles.chip)}>
      <Icon name="tab" />
      <span {...stylex.props(styles.chipText)}>{title || url}</span>
    </a>
  )
}

function ToolRow({ name, args, result, output }: { name: string; args: string; result?: any; output?: unknown }) {
  const out = result?.content ?? (output === undefined ? undefined : JSON.stringify(output, null, 2))
  return (
    <details {...stylex.props(styles.tool)}>
      <summary {...stylex.props(styles.toolSummary)}>
        <Icon name="tool" />
        <span>
          Used <strong>{name.replace(/_/g, ' ')}</strong>
        </span>
        {result?.state === 'error' || result?.error ? <span {...stylex.props(styles.toolErr)}>failed</span> : null}
      </summary>
      <pre {...stylex.props(styles.toolPre)}>{pretty(args)}</pre>
      {out !== undefined && <pre {...stylex.props(styles.toolPre)}>{typeof out === 'string' ? pretty(out) : JSON.stringify(out)}</pre>}
    </details>
  )
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <form
      {...stylex.props(styles.edit)}
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSave(value.trim())
      }}
    >
      <textarea
        autoFocus
        value={value}
        rows={Math.min(10, value.split('\n').length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        aria-label="Edit message"
        {...stylex.props(styles.editArea)}
      />
      <div {...stylex.props(styles.editActions)}>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          Save and resend
        </Button>
      </div>
    </form>
  )
}

const blink = stylex.keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } })

const styles = stylex.create({
  row: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.xs,
    marginBottom: space.xl,
  },
  rowUser: { alignItems: 'flex-end' },
  user: {
    maxWidth: '85%',
    backgroundColor: color.userBubble,
    color: color.ink,
    borderRadius: radius.lg,
    borderEndEndRadius: radius.sm,
    paddingInline: space.lg,
    paddingBlock: space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
  },
  userText: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: font.ui,
    fontSize: font.md,
    lineHeight: 1.5,
  },
  assistant: { width: '100%' },
  taskTag: {
    margin: 0,
    marginBottom: space.xs,
    fontFamily: font.ui,
    fontSize: font.xs,
    color: color.muted,
  },
  media: { maxWidth: '100%', maxHeight: '320px', borderRadius: radius.md, display: 'block' },
  audio: { maxWidth: '100%' },
  caret: {
    display: 'inline-block',
    width: '0.5em',
    height: '1.1em',
    verticalAlign: 'text-bottom',
    backgroundColor: color.accent,
    borderRadius: '1px',
    animationName: blink,
    animationDuration: '1s',
    animationIterationCount: 'infinite',
  },
  actions: {
    display: 'flex',
    gap: space.xxs,
    opacity: { default: 0.55, ':hover': 1, ':focus-within': 1 },
    transitionProperty: 'opacity',
    transitionDuration: motion.fast,
  },
  actionsUser: { justifyContent: 'flex-end' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '100%',
    paddingInline: space.md,
    height: size.control,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    color: color.ink,
    fontFamily: font.ui,
    fontSize: font.sm,
    textDecoration: 'none',
    alignSelf: 'flex-start',
  },
  chipText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tool: {
    marginBlock: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    fontFamily: font.ui,
    fontSize: font.sm,
    color: color.muted,
  },
  toolSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    paddingInline: space.md,
    paddingBlock: space.sm,
    cursor: 'pointer',
    listStyle: 'none',
  },
  toolErr: { color: color.danger },
  toolPre: {
    margin: 0,
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.line,
    fontFamily: font.mono,
    fontSize: font.xs,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: '240px',
    overflowY: 'auto',
  },
  edit: { display: 'flex', flexDirection: 'column', gap: space.sm, marginBottom: space.xl },
  editArea: {
    width: '100%',
    resize: 'vertical',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.accent,
    backgroundColor: color.surface,
    fontFamily: font.ui,
    fontSize: font.md,
    lineHeight: 1.5,
  },
  editActions: { display: 'flex', justifyContent: 'flex-end', gap: space.sm },
})
