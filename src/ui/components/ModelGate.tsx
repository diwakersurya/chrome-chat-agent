import * as stylex from '@stylexjs/stylex'
import type { Availability } from '../../core/ai/capabilities'
import { color, font, radius, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'

interface Props {
  model: Availability
  progress?: number
  error?: string
  onDownload: () => void
}

/** Shown instead of the chat until the on-device model can run. */
export function ModelGate({ model, progress, error, onDownload }: Props) {
  if (model === 'unavailable') return <Unavailable />
  const pct = progress == null ? undefined : Math.round(progress * 100)
  return (
    <section {...stylex.props(styles.wrap)}>
      <h1 {...stylex.props(styles.title)}>Download the on-device model</h1>
      <p {...stylex.props(styles.text)}>
        Chrome keeps one copy of its built-in model (Gemini Nano, or Gemma 4 when enabled) for every site and extension that uses it. It needs to download once (a few
        GB) and then works offline. After that, nothing you type leaves this device.
      </p>
      {model === 'downloading' ? (
        <div {...stylex.props(styles.progressWrap)}>
          <progress max={100} value={pct} aria-label="Download progress" {...stylex.props(styles.progress)} />
          <span {...stylex.props(styles.muted)}>{pct == null ? 'Starting download…' : `${pct}% downloaded`}</span>
        </div>
      ) : (
        <Button variant="primary" icon={error ? 'refresh' : 'download'} onClick={onDownload}>
          {error ? 'Try the download again' : 'Download the model'}
        </Button>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          <Icon name="alert" />
          <span>The download didn’t finish: {error}</span>
        </p>
      )}
    </section>
  )
}

function Unavailable() {
  return (
    <section {...stylex.props(styles.wrap)}>
      <h1 {...stylex.props(styles.title)}>Chrome’s built-in AI isn’t available here</h1>
      <p {...stylex.props(styles.text)}>This app needs Chrome’s built-in model (Gemini Nano or Gemma 4), which ships with desktop Chrome. Check that:</p>
      <ul {...stylex.props(styles.list)}>
        <li>
          You use Chrome {__TARGET__ === 'ext' ? '138' : '148'} or newer on Windows, macOS, Linux or a Chromebook Plus.
        </li>
        <li>The device has at least 22 GB of free disk space, and either a GPU with more than 4 GB of VRAM or 16 GB of RAM.</li>
        <li>
          On older Chrome versions, enable <code {...stylex.props(styles.code)}>chrome://flags/#optimization-guide-on-device-model</code> and{' '}
          <code {...stylex.props(styles.code)}>chrome://flags/#prompt-api-for-gemini-nano</code>, then restart Chrome.
        </li>
        <li>
          On Chrome 154+, <code {...stylex.props(styles.code)}>chrome://flags/#gemma4-for-built-in-ai</code> switches the built-in APIs to Gemma 4. It needs a GPU.
        </li>
        <li>
          Open <code {...stylex.props(styles.code)}>chrome://on-device-internals</code> to see the model’s status.
        </li>
      </ul>
    </section>
  )
}

const styles = stylex.create({
  wrap: {
    maxWidth: '56ch',
    marginInline: 'auto',
    paddingInline: space.lg,
    paddingTop: space.xxxl,
    fontFamily: font.ui,
    color: color.ink,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.lg,
  },
  title: { margin: 0, fontFamily: font.prose, fontWeight: 400, fontSize: font.xl, letterSpacing: '-0.01em' },
  text: { margin: 0, fontSize: font.md, lineHeight: 1.55, color: color.muted },
  list: { margin: 0, paddingInlineStart: space.lg, fontSize: font.sm, lineHeight: 1.7, color: color.muted },
  code: {
    fontFamily: font.mono,
    fontSize: font.xs,
    backgroundColor: color.sunken,
    paddingInline: space.xs,
    borderRadius: radius.sm,
    overflowWrap: 'anywhere',
  },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: space.sm, width: '100%' },
  progress: { width: '100%', accentColor: color.accent },
  muted: { fontSize: font.sm, color: color.muted },
  error: { display: 'flex', gap: space.sm, margin: 0, fontSize: font.sm, color: color.danger, lineHeight: 1.45 },
})
