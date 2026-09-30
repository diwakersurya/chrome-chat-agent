import * as stylex from '@stylexjs/stylex'
import { color } from './tokens.stylex'

// 'system' uses the media-query defaults in tokens; these force a scheme.
export const lightTheme = stylex.createTheme(color, {
  bg: '#F3F5F7',
  surface: '#FFFFFF',
  sunken: '#E9EDF1',
  ink: '#1B2633',
  muted: '#5D6B79',
  line: '#D9E0E6',
  accent: '#2A4F82',
  accentInk: '#FFFFFF',
  userBubble: '#E1E9F4',
  signal: '#1D8466',
  warn: '#9A5B00',
  danger: '#B3261E',
  focus: '#2A4F8266',
})

export const darkTheme = stylex.createTheme(color, {
  bg: '#11151A',
  surface: '#181E25',
  sunken: '#0D1115',
  ink: '#E2E8EE',
  muted: '#8D9AA8',
  line: '#27303A',
  accent: '#8DB0E6',
  accentInk: '#0D1115',
  userBubble: '#1F2B3B',
  signal: '#4CC79F',
  warn: '#E3B062',
  danger: '#F2877E',
  focus: '#8DB0E666',
})
