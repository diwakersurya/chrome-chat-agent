import { useEffect, useState } from 'react'
import { RESERVE, type DraftMeasure } from '../../core/ai/sessionCache'

/** below this the draft can't matter for the context window, so don't measure */
const MIN_CHARS = 400

/**
 * Live token count of everything the next message will send (text, page
 * context, skill instructions), so an oversized message is caught before sending.
 */
export function useDraftEstimate(draft: string, measure?: (text: string) => Promise<DraftMeasure>) {
  const [estimate, setEstimate] = useState<DraftMeasure>()
  useEffect(() => {
    if (!measure || draft.length < MIN_CHARS) return setEstimate(undefined)
    let alive = true
    const t = setTimeout(() => {
      measure(draft).then(
        (m) => alive && setEstimate(m),
        () => alive && setEstimate(undefined),
      )
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [draft, measure])

  const tooLong = !!estimate && estimate.tokens + RESERVE > estimate.window
  const willCompact = !!estimate && !tooLong && estimate.usage + estimate.tokens + RESERVE > estimate.window
  const label = !estimate
    ? undefined
    : tooLong
      ? `Too long for the model: about ${estimate.tokens.toLocaleString()} tokens, limit ${(estimate.window - RESERVE).toLocaleString()}. Shorten or split it.`
      : willCompact
        ? `About ${estimate.tokens.toLocaleString()} tokens. Sending will summarize older messages.`
        : `About ${estimate.tokens.toLocaleString()} tokens`
  return { tooLong, willCompact, label }
}
