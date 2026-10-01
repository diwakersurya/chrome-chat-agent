/** Turn model/runtime errors into plain language with a next step. */
export function friendlyError(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err))
  const text = `${e.name} ${e.message}`
  if (/QuotaExceeded|too large|too long for the model/i.test(text))
    return 'This is too long for the model’s memory. Shorten it, or start a new chat.'
  if (/destroyed|kErrorUnknown|service is not running/i.test(text))
    return 'The on-device model restarted. Try again.'
  if (/NotSupportedError/.test(e.name) && /image|audio|input/i.test(e.message))
    return 'The on-device model can’t read this kind of attachment.'
  if (/NotSupportedError|NotAllowedError/.test(e.name)) return 'Chrome refused this request for the on-device model. Try again.'
  if (/AbortError/.test(e.name)) return 'Stopped.'
  return e.message || 'Something went wrong. Try again.'
}
