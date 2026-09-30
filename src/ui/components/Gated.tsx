import * as stylex from '@stylexjs/stylex'
import { cloneElement, createContext, useContext, useEffect, useId, useState, type ReactElement } from 'react'
import { featureState, type FeatureEnv, type FeatureId } from '../../core/features'
import { color, font, radius, space } from '../tokens.stylex'

export const FeatureEnvContext = createContext<FeatureEnv>({ target: 'web' })

export function useFeature(id: FeatureId) {
  return featureState(id, useContext(FeatureEnvContext))
}

interface Props {
  feature: FeatureId
  children: ReactElement<Record<string, unknown>>
  /** extra condition from the call site (e.g. nothing to act on yet) with its own reason */
  unless?: { when: boolean; reason: string }
  /** anchor the tooltip to the child's end edge (for controls near the right side) */
  align?: 'start' | 'end'
}

/**
 * Renders the child as-is when the feature is available. Otherwise keeps it
 * visible but disabled, and explains why on hover, focus or click.
 */
export function Gated({ feature, children, unless, align = 'start' }: Props) {
  const state = useFeature(feature)
  const reason = !state.available ? state.reason : unless?.when ? unless.reason : undefined
  const [clicked, setClicked] = useState(false)
  const [hover, setHover] = useState(false)
  const id = useId()
  const open = clicked || hover

  useEffect(() => {
    if (!clicked) return
    const t = setTimeout(() => setClicked(false), 3000)
    return () => clearTimeout(t)
  }, [clicked])

  if (!reason) return children

  const child = cloneElement(children, {
    'aria-disabled': true,
    'aria-describedby': id,
    disabled: undefined,
    title: undefined,
    // keep it focusable/clickable so the reason can be read, but do nothing
    onClick: (e: Event) => {
      e.preventDefault()
      setClicked(true)
    },
    onChange: () => {},
  })

  return (
    <span
      {...stylex.props(styles.wrap)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => (setHover(false), setClicked(false))}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <span {...stylex.props(styles.dim)}>{child}</span>
      <span id={id} role="tooltip" {...stylex.props(styles.tip, align === 'end' && styles.tipEnd, open && styles.tipOpen)}>
        {reason}
      </span>
    </span>
  )
}

const styles = stylex.create({
  wrap: { position: 'relative', display: 'inline-flex' },
  dim: { display: 'inline-flex', opacity: 0.45, cursor: 'not-allowed' },
  tip: {
    position: 'absolute',
    bottom: `calc(100% + ${space.xs})`,
    insetInlineStart: 0,
    zIndex: 40,
    width: 'max-content',
    maxWidth: '260px',
    paddingInline: space.sm,
    paddingBlock: space.xs,
    borderRadius: radius.sm,
    backgroundColor: color.ink,
    color: color.bg,
    fontFamily: font.ui,
    fontSize: font.xs,
    lineHeight: 1.4,
    fontWeight: 400,
    whiteSpace: 'normal',
    pointerEvents: 'none',
    opacity: 0,
    visibility: 'hidden',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  tipOpen: { opacity: 1, visibility: 'visible' },
  tipEnd: { insetInlineStart: 'auto', insetInlineEnd: 0 },
})
