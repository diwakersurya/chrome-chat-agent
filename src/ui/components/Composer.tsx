import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Capabilities } from '../../core/ai/capabilities'
import { usable } from '../../core/ai/capabilities'
import { summarize } from '../../core/ai/taskApis'
import type { PageContext } from '../../platform/platform'
import { usePlatform } from '../../platform/platform'
import { audioAttachment, imageAttachment, startRecording, type Attachment } from '../attachments'
import { PAGE_TEXT_LIMIT } from '../pageContext'
import { RESERVE, type DraftMeasure } from '../../core/ai/sessionCache'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'

export interface Draft {
  text: string
  attachments: Attachment[]
  page?: PageContext & { body: string }
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
}

type Recorder = Awaited<ReturnType<typeof startRecording>>

export function Composer({ caps, busy, onSend, onStop, incomingPage, inputRef, measure, full }: Props) {
  const platform = usePlatform()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [page, setPage] = useState<Draft['page']>()
  const [pageState, setPageState] = useState<'idle' | 'reading' | 'summarizing'>('idle')
  const [notice, setNotice] = useState<string>()
  const [recorder, setRecorder] = useState<Recorder>()
  const fileRef = useRef<HTMLInputElement>(null)

  const attachPage = async (ctx: PageContext) => {
    const useSelection = ctx.selection.trim().length > 0
    let body = useSelection ? ctx.selection : ctx.text
    if (body.length > PAGE_TEXT_LIMIT) {
      if (usable(caps.summarizer)) {
        setPageState('summarizing')
        try {
          body = `(Summary of a long page)\n${await summarize(body.slice(0, 40000), 'key-points', 'long')}`
        } catch {
          body = body.slice(0, PAGE_TEXT_LIMIT)
        }
      } else body = body.slice(0, PAGE_TEXT_LIMIT)
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
    !busy && !full && !recorder && pageState === 'idle' && !tooLong && (text.trim() || attachments.length || page)

  const send = () => {
    if (!canSend) return
    onSend({ text: text.trim(), attachments, page })
    setText('')
    setAttachments([])
    setPage(undefined)
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
      {(attachments.length > 0 || page || pageState !== 'idle') && (
        <ul {...stylex.props(styles.chips)} aria-label="Attachments">
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
        ref={inputRef}
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
        onChange={(e) => setText(e.target.value)}
        onPaste={(e: ClipboardEvent) => {
          const files = [...e.clipboardData.files]
          if (files.length && caps.image) {
            e.preventDefault()
            void addFiles(files)
          }
        }}
        onKeyDown={(e) => {
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
          {caps.image && (
            <>
              <Button icon="image" label="Attach image" onClick={() => fileRef.current?.click()} />
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
            </>
          )}
          {caps.audio && (
            <Button
              icon="mic"
              label={recorder ? 'Stop recording' : 'Record voice'}
              aria-pressed={!!recorder}
              onClick={toggleRecording}
              xstyle={recorder && styles.recording}
            />
          )}
          {platform.getPageContext && (
            <Button icon="tab" onClick={readTab} disabled={pageState !== 'idle'} variant="ghost">
              Use this tab
            </Button>
          )}
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
  thumb: { width: '22px', height: '22px', objectFit: 'cover', borderRadius: radius.sm },
})
