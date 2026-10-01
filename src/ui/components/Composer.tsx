import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import type { DraftMeasure } from '../../core/ai/sessionCache'
import { summarize } from '../../core/ai/taskApis'
import type { SkillRow } from '../../core/db/repo'
import { formatSkillPart, suggestSkill } from '../../core/skills/skills'
import type { PageContext } from '../../platform/platform'
import { usePlatform } from '../../platform/platform'
import { imageAttachment, type Attachment } from '../attachments'
import { useDraftEstimate } from '../composer/useDraftEstimate'
import { useMention, type Mention } from '../composer/useMention'
import { useRecorder } from '../composer/useRecorder'
import { PAGE_TEXT_LIMIT } from '../pageContext'
import { color, font, motion, radius, space } from '../tokens.stylex'
import { Button } from './Button'
import { DraftChips } from './DraftChips'
import { Gated } from './Gated'
import { Icon } from './Icon'
import { MentionPicker, type MentionItem } from './MentionPicker'

export interface Draft {
  text: string
  attachments: Attachment[]
  page?: PageContext & { body: string }
  skills: SkillRow[]
}

export type PageState = 'idle' | 'reading' | 'summarizing'

interface Props {
  caps: Capabilities
  busy: boolean
  onSend: (draft: Draft) => void
  onStop: () => void
  /** page context pushed in from outside (context-menu selection), used once */
  incomingPage?: PageContext
  onIncomingUsed?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  /** count a draft's tokens against this chat's remaining context */
  measure?: (text: string) => Promise<DraftMeasure>
  /** the chat can't continue (its history no longer fits the model) */
  full?: boolean
  /** enabled skills, offered after "/" */
  skills: SkillRow[]
  /** tool sources (MCP servers, this tab), offered after "@" */
  sources: MentionItem[]
  onAddSource: (id: string) => void
}

export function Composer({ caps, busy, onSend, onStop, incomingPage, onIncomingUsed, inputRef, measure, full, skills, sources, onAddSource }: Props) {
  const platform = usePlatform()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [page, setPage] = useState<Draft['page']>()
  const [pageState, setPageState] = useState<PageState>('idle')
  const [notice, setNotice] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [picked, setPicked] = useState<SkillRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const ta = inputRef ?? localRef

  const mention = useMention({
    text,
    setText,
    ta,
    itemsFor: (m: Mention) =>
      m.char === '/'
        ? skills
            .filter((s) => !picked.some((p) => p.id === s.id))
            .filter((s) => s.name.includes(m.query) || s.description.toLowerCase().includes(m.query))
            .map((s) => ({ id: s.id, label: `/${s.name}`, detail: s.description, icon: 'book' as const }))
        : sources.filter((x) => x.label.toLowerCase().includes(m.query)),
    onPick: (m, item) => {
      if (m.char === '/') {
        const s = skills.find((x) => x.id === item.id)
        if (s) setPicked((p) => [...p, s])
      } else onAddSource(item.id)
    },
  })

  const recorder = useRecorder((a) => setAttachments((list) => [...list, a]), setNotice)
  const suggestion = picked.length === 0 && text.length > 12 ? suggestSkill(text, skills) : undefined

  const attachPage = async (ctx: PageContext) => {
    const useSelection = ctx.selection.trim().length > 0
    let body = useSelection ? ctx.selection : ctx.text
    if (body.length > PAGE_TEXT_LIMIT) {
      // summarize() falls back to the chat model when the Summarizer API can't run
      setPageState('summarizing')
      try {
        body = `(Summary of a long page)\n${await summarize(body.slice(0, 40000), 'key-points', 'long')}`
      } catch {
        body = body.slice(0, PAGE_TEXT_LIMIT)
      }
    }
    setPage({ ...ctx, title: useSelection ? `Selection from ${ctx.title}` : ctx.title, body })
    setPageState('idle')
  }

  useEffect(() => {
    if (!incomingPage) return
    onIncomingUsed?.()
    void attachPage(incomingPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPage])

  const readTab = async () => {
    setNotice(undefined)
    setPageState('reading')
    try {
      await attachPage(await platform.getPageContext!())
    } catch (e) {
      setPageState('idle')
      setNotice((e as Error).message)
    }
  }

  const addFiles = async (files: Iterable<File>) => {
    const all = [...files]
    if (!all.length) return
    if (!caps.image) return setNotice('The on-device model on this device can’t read images.')
    const images = all.filter((f) => f.type.startsWith('image/'))
    if (images.length < all.length) setNotice('Only images can be attached. Other files were skipped.')
    else setNotice(undefined)
    const added = await Promise.all(images.map(imageAttachment))
    setAttachments((a) => [...a, ...added])
  }

  // everything the next message sends counts against the model's memory
  const draftText = [...picked.map(formatSkillPart), page?.body, text].filter(Boolean).join('\n\n')
  const estimate = useDraftEstimate(draftText, measure)

  const canSend =
    !busy &&
    !full &&
    !recorder.recording &&
    pageState === 'idle' &&
    !estimate.tooLong &&
    (text.trim() || attachments.length || page || picked.length)

  const send = () => {
    if (!canSend) return
    onSend({ text: text.trim(), attachments, page, skills: picked })
    setText('')
    setAttachments([])
    setPage(undefined)
    setPicked([])
    setNotice(undefined)
    mention.close()
  }

  return (
    <form
      {...stylex.props(styles.wrap, dragging && styles.dragging)}
      onSubmit={(e) => (e.preventDefault(), send())}
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e: DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        setDragging(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      {mention.mention && (
        <MentionPicker
          title={mention.mention.char === '/' ? 'Skills' : 'Tools for this chat'}
          items={mention.items}
          index={mention.active}
          empty={
            mention.mention.char === '/'
              ? skills.length
                ? 'No skill matches. Keep typing, or press Escape.'
                : 'No skills yet. Add SKILL.md files in Settings → Skills.'
              : sources.length
                ? 'Nothing matches.'
                : 'No tool sources yet. Add MCP servers in Settings → Tools.'
          }
          onPick={mention.pick}
          onHover={mention.setIndex}
        />
      )}
      <DraftChips
        picked={picked}
        onRemoveSkill={(id) => setPicked((p) => p.filter((x) => x.id !== id))}
        suggestion={suggestion}
        onUseSuggestion={(s) => setPicked([s])}
        page={page}
        pageState={pageState}
        onRemovePage={() => setPage(undefined)}
        attachments={attachments}
        onRemoveAttachment={(i) => setAttachments((list) => list.filter((_, j) => j !== i))}
      />

      <textarea
        ref={ta}
        value={text}
        disabled={full}
        placeholder={
          full
            ? 'This chat is full. Start a new chat to continue.'
            : recorder.recording
              ? 'Recording… press the mic again to stop'
              : 'Message your on-device model'
        }
        aria-label="Message"
        aria-keyshortcuts="Enter"
        rows={1}
        onChange={(e) => {
          setText(e.target.value)
          mention.sync(e.target.value, e.target.selectionStart)
        }}
        onSelect={(e) => mention.sync(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(mention.close, 150)}
        onPaste={(e: ClipboardEvent) => {
          const files = [...e.clipboardData.files]
          if (files.length) {
            e.preventDefault()
            void addFiles(files)
          }
        }}
        onKeyDown={(e) => {
          if (mention.onKeyDown(e)) return
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
          if (e.key === 'Escape' && busy) onStop()
        }}
        {...stylex.props(styles.input)}
      />

      <div {...stylex.props(styles.bar)}>
        <div {...stylex.props(styles.tools)}>
          <Gated feature="image-input">
            <Button icon="image" label="Attach image (or paste, or drop)" onClick={() => fileRef.current?.click()} />
          </Gated>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Gated feature="audio-input">
            <Button
              icon="mic"
              label={recorder.recording ? 'Stop recording' : 'Record voice'}
              aria-pressed={recorder.recording}
              onClick={recorder.toggle}
              xstyle={recorder.recording && styles.recording}
            />
          </Gated>
          {recorder.recording && (
            <span aria-live="off" {...stylex.props(styles.timer)}>
              {recorder.elapsed}
            </span>
          )}
          <Gated feature="page-context">
            <Button icon="tab" onClick={readTab} disabled={pageState !== 'idle'} variant="ghost">
              Use this tab
            </Button>
          </Gated>
          <Gated feature="skills">
            <Button icon="book" label="Use a skill (type /)" onClick={() => mention.insert('/')} />
          </Gated>
          <Gated feature="agent-tools">
            <Button icon="plug" label="Add tools to this chat (type @)" onClick={() => mention.insert('@')} />
          </Gated>
          {notice && (
            <span role="status" {...stylex.props(styles.notice)}>
              <Icon name="alert" /> {notice}
            </span>
          )}
        </div>
        {estimate.label && (
          <span
            role="status"
            {...stylex.props(styles.estimate, estimate.willCompact && styles.estimateWarn, estimate.tooLong && styles.estimateBad)}
          >
            {estimate.label}
          </span>
        )}
        {busy ? (
          <Button icon="stop" label="Stop generating (Esc)" variant="quiet" onClick={onStop} />
        ) : (
          <Button icon="send" label="Send (Enter)" variant="primary" type="submit" disabled={!canSend} />
        )}
      </div>
    </form>
  )
}

const pulse = stylex.keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.4 } })

const styles = stylex.create({
  wrap: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.line, ':focus-within': color.accent },
    backgroundColor: color.surface,
    transitionProperty: 'border-color',
    transitionDuration: motion.fast,
  },
  dragging: { borderStyle: 'dashed', borderColor: color.accent, backgroundColor: color.sunken },
  input: {
    fieldSizing: 'content',
    minHeight: '1.5em',
    maxHeight: '40vh',
    resize: 'none',
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    fontFamily: font.ui,
    fontSize: font.md,
    lineHeight: 1.5,
    paddingInline: space.xs,
  },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  tools: { display: 'flex', alignItems: 'center', gap: space.xxs, flexWrap: 'wrap', minWidth: 0 },
  recording: {
    color: color.danger,
    animationName: pulse,
    animationDuration: motion.loop,
    animationIterationCount: 'infinite',
  },
  timer: { fontFamily: font.ui, fontSize: font.xs, fontVariantNumeric: 'tabular-nums', color: color.danger },
  estimate: {
    fontFamily: font.ui,
    fontSize: font.xs,
    fontVariantNumeric: 'tabular-nums',
    color: color.muted,
    textAlign: 'end',
    marginInlineStart: 'auto',
  },
  estimateWarn: { color: color.warn },
  estimateBad: { color: color.danger, fontWeight: 600 },
  notice: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    color: color.warn,
    fontFamily: font.ui,
    fontSize: font.xs,
  },
})
