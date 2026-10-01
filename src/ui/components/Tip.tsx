import * as stylex from '@stylexjs/stylex'
import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { color, font, motion, radius, size, space } from '../tokens.stylex'

interface Props {
  text: string
  children: ReactElement<Record<string, unknown>>
  /** preferred horizontal anchor; flips automatically if it would leave the viewport */
  align?: 'start' | 'end'
  /** wrapper class from the caller (e.g. dimming for disabled controls) */
  xstyle?: stylex.StyleXStyles
  /** extra handlers merged onto the child */
  childProps?: Record<string, unknown>
}

/**
 * Tooltip that works with mouse, keyboard and touch: opens on hover, focus
 * and tap, stays on screen at narrow widths, and is linked via aria-describedby.
 */
export function Tip({ text, children, align = 'start', xstyle, childProps }: Props) {
  const [hover, setHover] = useState(false)
  const [tapped, setTapped] = useState(false)
  const [place, setPlace] = useState<{ end: boolean; below: boolean }>({ end: align === 'end', below: false })
  const tipRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const open = hover || tapped

  useEffect(() => {
    if (!tapped) return
    const t = setTimeout(() => setTapped(false), 3000)
    return () => clearTimeout(t)
  }, [tapped])

  // keep it inside the viewport (side panel is ~400px wide)
  useLayoutEffect(() => {
    if (!open) return setPlace({ end: align === 'end', below: false })
    const r = tipRef.current?.getBoundingClientRect()
    if (!r) return
    const gutter = 8
    setPlace((p) => ({
      end: r.right > innerWidth - gutter ? true : r.left < gutter ? false : p.end,
      below: r.top < gutter ? true : p.below,
    }))
  }, [open, align])

  const child = cloneElement(children, {
    ...childProps,
    'aria-describedby': id,
    title: undefined,
    onClick: (e: Event) => {
      ;(childProps?.onClick as ((e: Event) => void) | undefined)?.(e)
      setTapped((t) => !t)
    },
  })

  return (
    <span
      {...stylex.props(styles.wrap, xstyle)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => (setHover(false), setTapped(false))}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {child}
      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        {...stylex.props(styles.tip, place.end && styles.end, place.below && styles.below, open && styles.open)}
      >
        {text}
      </span>
    </span>
  )
}

const styles = stylex.create({
  wrap: { position: 'relative', display: 'inline-flex' },
  tip: {
    position: 'absolute',
    bottom: `calc(100% + ${space.xs})`,
    insetInlineStart: 0,
    zIndex: 40,
    width: 'max-content',
    maxWidth: `min(${size.tooltip}, calc(100vw - 2 * ${space.sm}))`,
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
    transitionDuration: motion.fast,
  },
  end: { insetInlineStart: 'auto', insetInlineEnd: 0 },
  below: { bottom: 'auto', top: `calc(100% + ${space.xs})` },
  open: { opacity: 1, visibility: 'visible' },
})
