import * as stylex from '@stylexjs/stylex'

const DARK = '@media (prefers-color-scheme: dark)'

export const color = stylex.defineVars({
  bg: { default: '#F3F5F7', [DARK]: '#11151A' },
  surface: { default: '#FFFFFF', [DARK]: '#181E25' },
  sunken: { default: '#E9EDF1', [DARK]: '#0D1115' },
  ink: { default: '#1B2633', [DARK]: '#E2E8EE' },
  muted: { default: '#5D6B79', [DARK]: '#8D9AA8' },
  line: { default: '#D9E0E6', [DARK]: '#27303A' },
  accent: { default: '#2A4F82', [DARK]: '#8DB0E6' },
  accentInk: { default: '#FFFFFF', [DARK]: '#0D1115' },
  userBubble: { default: '#E1E9F4', [DARK]: '#1F2B3B' },
  signal: { default: '#1D8466', [DARK]: '#4CC79F' },
  warn: { default: '#9A5B00', [DARK]: '#E3B062' },
  danger: { default: '#B3261E', [DARK]: '#F2877E' },
  focus: { default: '#2A4F82', [DARK]: '#8DB0E6' },
  scrim: { default: 'rgba(10, 16, 24, 0.35)', [DARK]: 'rgba(0, 0, 0, 0.5)' },
})

export const space = stylex.defineVars({
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
})

export const radius = stylex.defineVars({
  sm: '6px',
  md: '10px',
  lg: '16px',
  pill: '999px',
})

export const font = stylex.defineVars({
  ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  prose: '"Iowan Old Style", "Charter", "Palatino Linotype", "Book Antiqua", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  xs: '12px',
  sm: '13px',
  md: '15px',
  prosePx: '17px',
  lg: '20px',
  xl: '28px',
})

export const size = stylex.defineVars({
  sidebar: '272px',
  readable: '72ch',
  header: '52px',
  icon: '18px',
  control: '32px',
  /** comfortable touch target for coarse pointers */
  tap: '40px',
  chip: '26px',
  dot: '8px',
  dotLg: '10px',
  thumb: '22px',
  meter: '44px',
  tooltip: '260px',
  menu: '200px',
  popover: '280px',
  panel: '420px',
  field: '180px',
  chipText: '220px',
  media: '320px',
  toolOutput: '240px',
  notice: '200px',
})

export const shadow = stylex.defineVars({
  popover: '0 8px 28px rgba(15, 25, 40, 0.18)',
  panel: '-12px 0 40px rgba(15, 25, 40, 0.18)',
  drawer: '8px 0 30px rgba(15, 25, 40, 0.2)',
  toast: '0 10px 30px rgba(15, 25, 40, 0.25)',
})

export const motion = stylex.defineVars({
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
  /** looping indicators (skeleton shimmer, recording pulse) */
  loop: '1.4s',
  blink: '1s',
})
