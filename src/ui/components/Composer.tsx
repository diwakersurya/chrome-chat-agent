import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import { summarize } from '../../core/ai/taskApis'
import type { PageContext } from '../../platform/platform'
import { usePlatform } from '../../platform/platform'
import { audioAttachment, imageAttachment, startRecording, type Attachment } from '../attachments'
import { PAGE_TEXT_LIMIT } from '../pageContext'
import { RESERVE, type DraftMeasure } from '../../core/ai/sessionCache'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Gated } from './Gated'
import { Icon } from './Icon'
import { MentionPicker, type MentionItem } from './MentionPicker'
import type { SkillRow } from '../../core/db/repo'
import { suggestSkill } from '../../core/skills/skills'

export interface Draft {
  text: string
  attachments: Attachment[]
  page?: PageContext & { body: string }
  skills: SkillRow[]
}

interface Props {
  caps: Capabilities
  busy: boolean
  onSend: (draft: Draft) => void
  onStop: () => void
  /** page context pushed in from outside (context-menu selection) */
  incomingPage?: PageContext
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

type Mention = { char: '/' | '@'; query: string; start: number }

/** "/que" or "@que" right before the caret opens a picker. */
function mentionAt(text: string, caret: number): Mention | undefined {
  const m = /(^|\s)([/@])([\w.-]*)$/.exec(text.slice(0, caret))
  return m ? { char: m[2] as Mention['char'], query: m[3]!.toLowerCase(), start: caret - m[3]!.length - 1 } : undefined
}

type Recorder = Awaited<ReturnType<typeof startRecording>>

export function Composer({ caps, busy, onSend, onStop, incomingPage, inputRef, measure, full, skills, sources, onAddSource }: Props) {
  const platform = usePlatform()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [page, setPage] = useState<Draft['page']>()
  const [pageState, setPageState] = useState<'idle' | 'reading' | 'summarizing'>('idle')
  const [notice, setNotice] = useState<string>()
  const [recorder, setRecorder] = useState<Recorder>()
  const fileRef = useRef<HTMLInputElement>(null)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const ta = inputRef ?? localRef
  const [picked, setPicked] = useState<SkillRow[]>([])
  const [mention, setMention] = useState<Mention>()
  const [mIndex, setMIndex] = useState(0)
  // caret to restore after a programmatic text change, applied before the next keystroke
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current == null || !ta.current) return
    ta.current.focus()
    ta.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [text])

  const mentionItems: MentionItem[] = !mention
    ? []
    : mention.char === '/'
      ? skills
          .filter((s) => !picked.some((p) => p.id === s.id))
          .filter((s) => s.name.includes(mention.query) || s.description.toLowerCase().includes(mention.query))
          .map((s) => ({ id: s.id, label: `/${s.name}`, detail: s.description, icon: 'book' as const }))
      : sources.filter((x) => x.label.toLowerCase().includes(mention.query))

  const syncMention = (value: string, caret: number) => {
    const m = mentionAt(value, caret)
    setMention(m)
    if (m?.query !== mention?.query || m?.char !== mention?.char) setMIndex(0)
  }

  const pick = (item: MentionItem) => {
    if (!mention || item.unavailable) return
    const end = ta.current?.selectionStart ?? text.length
    const next = text.slice(0, mention.start) + text.slice(end)
    setText(next)
    setMention(undefined)
    if (mention.char === '/') {
      const s = skills.find((x) => x.id === item.id)
      if (s) setPicked((p) => [...p, s])
    } else onAddSource(item.id)
    caret.current = mention.start
  }

  /** Put a trigger character at the caret, e.g. from the Skills / Tools buttons. */
  const insertTrigger = (char: '/' | '@') => {
    const at = ta.current?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const insert = (before && !/\s$/.test(before) ? ' ' : '') + char
    const next = before + insert + text.slice(at)
    setText(next)
    const pos = at + insert.length
    setMention({ char, query: '', start: pos - 1 })
    setMIndex(0)
    caret.current = pos
  }

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
    if (incomingPage) void attachPage(incomingPage)
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
    if (!caps.image) return
    const images = [...files].filter((f) => f.type.startsWith('image/'))
    const added = await Promise.all(images.map(imageAttachment))
    setAttachments((a) => [...a, ...added])
  }

  const toggleRecording = async () => {
    setNotice(undefined)
    if (recorder) {
      setRecorder(undefined)
      const blob = await recorder.stop()
      const att = await audioAttachment(blob)
      setAttachments((a) => [...a, att])
      return
    }
    try {
      setRecorder(await startRecording())
    } catch {
      setNotice('Microphone access was blocked. Allow it in the site settings to record.')
    }
  }

  // Live token estimate so an oversized message is caught before sending.
  const [estimate, setEstimate] = useState<DraftMeasure>()
  const draftText = [page?.body, text].filter(Boolean).join('\n\n')
  useEffect(() => {
    if (!measure || draftText.length < 400) return setEstimate(undefined)
    let live = true
    const t = setTimeout(() => {
      measure(draftText).then((m) => live && setEstimate(m), () => live && setEstimate(undefined))
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [draftText, measure])
  const tooLong = !!estimate && estimate.tokens + RESERVE > estimate.window
  const willCompact = !!estimate && !tooLong && estimate.usage + estimate.tokens + RESERVE > estimate.window

  const canSend =
    !busy &&
    !full &&
    !recorder &&
    pageState === 'idle' &&
    !tooLong &&
    (text.trim() || attachments.length || page || picked.length)

  const send = () => {
    if (!canSend) return
    onSend({ text: text.trim(), attachments, page, skills: picked })
    setText('')
    setAttachments([])
    setPage(undefined)
    setPicked([])
    setMention(undefined)
  }

  return (
    <form
      {...stylex.props(styles.wrap)}
      onSubmit={(e) => (e.preventDefault(), send())}
      onDragOver={(e: DragEvent) => caps.image && e.preventDefault()}
      onDrop={(e: DragEvent) => {
        if (!caps.image) return
        e.preventDefault()
        void addFiles(e.dataTransfer.files)
      }}
    >
      {mention && (
        <MentionPicker
          title={mention.char === '/' ? 'Skills' : 'Tools for this chat'}
          items={mentionItems}
          index={Math.min(mIndex, Math.max(0, mentionItems.length - 1))}
          empty={
            mention.char === '/'
              ? skills.length
                ? 'No skill matches. Keep typing, or press Escape.'
                : 'No skills yet. Add SKILL.md files in Settings → Skills.'
              : sources.length
                ? 'Nothing matches.'
                : 'No tool sources yet. Add MCP servers in Settings → Tools.'
          }
          onPick={pick}
          onHover={setMIndex}
        />
      )}
      {(attachments.length > 0 || page || pageState !== 'idle' || picked.length > 0 || suggestion) && (
        <ul {...stylex.props(styles.chips)} aria-label="Attachments">
          {picked.map((s) => (
            <li key={s.id} {...stylex.props(styles.chip)} title={s.description}>
              <Icon name="book" />
              <span {...stylex.props(styles.chipText)}>/{s.name}</span>
              <Button
                icon="x"
                label={`Remove skill ${s.name}`}
                onClick={() => setPicked((p) => p.filter((x) => x.id !== s.id))}
                xstyle={styles.chipX}
              />
            </li>
          ))}
          {suggestion && (
            <li>
              <button
                type="button"
                onClick={() => setPicked([suggestion])}
                title={suggestion.description}
                {...stylex.props(styles.chip, styles.suggest)}
              >
                <Icon name="book" />
                Use /{suggestion.name}?
              </button>
            </li>
          )}
          {pageState !== 'idle' && (
            <li {...stylex.props(styles.chip)}>
              <Icon name="tab" />
              <span>{pageState === 'reading' ? 'Reading the page…' : 'Summarizing the page…'}</span>
            </li>
          )}
          {page && (
            <li {...stylex.props(styles.chip)} title={page.url}>
              <Icon name="tab" />
              <span {...stylex.props(styles.chipText)}>{page.title || page.url}</span>
              <Button icon="x" label="Remove page" onClick={() => setPage(undefined)} xstyle={styles.chipX} />
            </li>
          )}
          {attachments.map((a, i) => (
            <li key={i} {...stylex.props(styles.chip)}>
              {a.kind === 'image' ? (
                <img alt="" src={`data:${a.mimeType};base64,${a.data}`} {...stylex.props(styles.thumb)} />
              ) : (
                <Icon name="mic" />
              )}
              <span {...stylex.props(styles.chipText)}>{a.name}</span>
              <Button
                icon="x"
                label={`Remove ${a.name}`}
                onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                xstyle={styles.chipX}
              />
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={ta}
        value={text}
        disabled={full}
        placeholder={
          full
            ? 'This chat is full. Start a new chat to continue.'
            : recorder
              ? 'Recording… press the mic again to stop'
              : 'Message your on-device model'
        }
        aria-label="Message"
        rows={1}
        onChange={(e) => {
          setText(e.target.value)
          syncMention(e.target.value, e.target.selectionStart)
        }}
        onSelect={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setMention(undefined), 150)}
        onPaste={(e: ClipboardEvent) => {
          const files = [...e.clipboardData.files]
          if (files.length && caps.image) {
            e.preventDefault()
            void addFiles(files)
          }
        }}
        onKeyDown={(e) => {
          if (mention) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = mentionItems.length || 1
              setMIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
              return
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && mentionItems.length) {
              e.preventDefault()
              pick(mentionItems[Math.min(mIndex, mentionItems.length - 1)]!)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setMention(undefined)
              return
            }
          }
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
            <Button icon="image" label="Attach image" onClick={() => fileRef.current?.click()} />
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
              label={recorder ? 'Stop recording' : 'Record voice'}
              aria-pressed={!!recorder}
              onClick={toggleRecording}
              xstyle={recorder && styles.recording}
            />
          </Gated>
          <Gated feature="page-context">
            <Button icon="tab" onClick={readTab} disabled={pageState !== 'idle'} variant="ghost">
              Use this tab
            </Button>
          </Gated>
          <Gated feature="skills">
            <Button icon="book" label="Use a skill (type /)" onClick={() => insertTrigger('/')} />
          </Gated>
          <Gated feature="agent-tools">
            <Button icon="plug" label="Add tools to this chat (type @)" onClick={() => insertTrigger('@')} />
          </Gated>
          {notice && (
            <span role="status" {...stylex.props(styles.notice)}>
              <Icon name="alert" /> {notice}
            </span>
          )}
        </div>
        {estimate && (
          <span
            role="status"
            {...stylex.props(styles.estimate, willCompact && styles.estimateWarn, tooLong && styles.estimateBad)}
          >
            {tooLong
              ? `Too long for the model: about ${estimate.tokens.toLocaleString()} tokens, limit ${(estimate.window - RESERVE).toLocaleString()}. Shorten or split it.`
              : willCompact
                ? `About ${estimate.tokens.toLocaleString()} tokens. Sending will summarize older messages.`
                : `About ${estimate.tokens.toLocaleString()} tokens`}
          </span>
        )}
        {busy ? (
          <Button icon="stop" label="Stop generating" variant="quiet" onClick={onStop} />
        ) : (
          <Button icon="send" label="Send" variant="primary" type="submit" disabled={!canSend} />
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
    animationDuration: '1.2s',
    animationIterationCount: 'infinite',
  },
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
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '100%',
    height: size.control,
    paddingInlineStart: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.sunken,
    color: color.ink,
    fontFamily: font.ui,
    fontSize: font.sm,
  },
  chipText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' },
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
  thumb: { width: '22px', height: '22px', objectFit: 'cover', borderRadius: radius.sm },
})
