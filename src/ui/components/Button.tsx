import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { color, font, motion, radius, size, space } from '../tokens.stylex'
import { Icon, type IconName } from './Icon'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName
  /** icon-only buttons must pass a label (used for aria-label + tooltip) */
  label?: string
  variant?: 'ghost' | 'primary' | 'quiet' | 'danger'
  xstyle?: stylex.StyleXStyles
}

export function Button({ icon, label, variant = 'ghost', xstyle, children, ...rest }: Props) {
  const iconOnly = !children
  return (
    <button
      type="button"
      aria-label={iconOnly ? label : undefined}
      title={label}
      {...rest}
      {...stylex.props(styles.base, styles[variant], iconOnly && styles.iconOnly, xstyle)}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: size.control,
    paddingInline: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    fontFamily: font.ui,
    fontSize: font.sm,
    fontWeight: 500,
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
    opacity: { default: 1, ':disabled': 0.45 },
    transitionProperty: 'background-color, color, border-color',
    transitionDuration: motion.fast,
    whiteSpace: 'nowrap',
  },
  iconOnly: { width: size.control, paddingInline: 0 },
  ghost: {
    backgroundColor: { default: 'transparent', ':hover:not(:disabled)': color.sunken },
    color: { default: color.muted, ':hover:not(:disabled)': color.ink },
  },
  quiet: {
    backgroundColor: { default: color.surface, ':hover:not(:disabled)': color.sunken },
    borderColor: color.line,
    color: color.ink,
  },
  primary: {
    backgroundColor: color.accent,
    color: color.accentInk,
    opacity: { default: 1, ':hover:not(:disabled)': 0.9, ':disabled': 0.4 },
  },
  danger: {
    backgroundColor: { default: 'transparent', ':hover:not(:disabled)': color.sunken },
    borderColor: color.line,
    color: color.danger,
  },
})
