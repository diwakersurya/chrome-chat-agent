import type { ContextStats } from '../core/ai/sessionCache'

/** How full the model's context window is, for the header meter and the "chat is full" notice. */
export function contextBudget(stats: ContextStats) {
  const pct = stats.window ? Math.min(100, Math.round((stats.usage / stats.window) * 100)) : 0
  const left = Math.max(0, stats.window - stats.usage)
  // the router prompt and reply room need ~1.5-2k tokens, so turns start failing
  // (and get summarised) well before 100%; warn from 70%
  const level = pct >= 70 ? 'full' : pct >= 55 ? 'filling' : 'ok'
  return { pct, left, level } as const
}
