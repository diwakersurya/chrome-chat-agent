import * as stylex from '@stylexjs/stylex'
import type { SkillRow } from '../../core/db/repo'
import type { Attachment } from '../attachments'
import { color, font, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import type { Draft, PageState } from './Composer'
import { Icon } from './Icon'

interface Props {
  picked: SkillRow[]
  onRemoveSkill: (id: string) => void
  suggestion?: SkillRow
  onUseSuggestion: (s: SkillRow) => void
  page?: Draft['page']
  pageState: PageState
  onRemovePage: () => void
  attachments: Attachment[]
  onRemoveAttachment: (index: number) => void
}

/** What will be sent with the next message: skills, page context, files. */
export function DraftChips(p: Props) {
  if (!p.picked.length && !p.suggestion && !p.page && p.pageState === 'idle' && !p.attachments.length) return null
  return (
    <ul {...stylex.props(styles.chips)} aria-label="Attachments">
      {p.picked.map((s) => (
        <li key={s.id} {...stylex.props(styles.chip)} title={s.description}>
          <Icon name="book" />
          <span {...stylex.props(styles.chipText)}>/{s.name}</span>
          <Button icon="x" label={`Remove skill ${s.name}`} onClick={() => p.onRemoveSkill(s.id)} xstyle={styles.chipX} />
        </li>
      ))}
      {p.suggestion && (
        <li>
          <button
            type="button"
            onClick={() => p.onUseSuggestion(p.suggestion!)}
            title={p.suggestion.description}
            {...stylex.props(styles.chip, styles.suggest)}
          >
            <Icon name="book" />
            Use /{p.suggestion.name}?
          </button>
        </li>
      )}
      {p.pageState !== 'idle' && (
        <li {...stylex.props(styles.chip)} role="status">
          <Icon name="tab" />
          <span>{p.pageState === 'reading' ? 'Reading the page…' : 'Summarizing the page…'}</span>
        </li>
      )}
      {p.page && (
        <li {...stylex.props(styles.chip)} title={p.page.url}>
          <Icon name="tab" />
          <span {...stylex.props(styles.chipText)}>{p.page.title || p.page.url}</span>
          <Button icon="x" label="Remove page" onClick={p.onRemovePage} xstyle={styles.chipX} />
        </li>
      )}
      {p.attachments.map((a, i) => (
        <li key={i} {...stylex.props(styles.chip)}>
          {a.kind === 'image' ? (
            <img alt="" src={`data:${a.mimeType};base64,${a.data}`} {...stylex.props(styles.thumb)} />
          ) : (
            <Icon name="mic" />
          )}
          <span {...stylex.props(styles.chipText)}>{a.name}</span>
          <Button icon="x" label={`Remove ${a.name}`} onClick={() => p.onRemoveAttachment(i)} xstyle={styles.chipX} />
        </li>
      ))}
    </ul>
  )
}

const styles = stylex.create({
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '100%',
    height: size.control,
    paddingInlineStart: space.sm,
    paddingInlineEnd: space.xs,
    borderRadius: radius.pill,
    borderWidth: 0,
    backgroundColor: color.sunken,
    color: color.ink,
    fontFamily: font.ui,
    fontSize: font.sm,
  },
  chipText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: size.chipText },
  chipX: { borderRadius: radius.pill },
  suggest: {
    paddingInlineEnd: space.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.accent,
    backgroundColor: 'transparent',
    color: color.accent,
    cursor: 'pointer',
  },
  thumb: { width: size.thumb, height: size.thumb, objectFit: 'cover', borderRadius: radius.sm },
})
