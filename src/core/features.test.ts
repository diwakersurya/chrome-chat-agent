import { expect, it } from 'vitest'
import type { Capabilities } from './ai/capabilities'
import { FEATURES, featureState } from './features'

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  prompt: 'available',
  image: true,
  audio: true,
  sampling: true,
  deterministicOnly: false,
  summarizer: 'available',
  translator: true,
  languageDetector: 'available',
  writer: 'available',
  rewriter: 'available',
  proofreader: 'available',
  ...over,
})

it('gates extension-only features on the web with a reason', () => {
  for (const id of ['page-context', 'webmcp', 'sampling'] as const) {
    const s = featureState(id, { target: 'web', caps: caps() })
    expect(s.available).toBe(false)
    expect(s.reason).toBeTruthy()
    expect(featureState(id, { target: 'ext', caps: caps() }).available).toBe(true)
  }
})

it('applies runtime reasons after the platform check', () => {
  expect(featureState('image-input', { target: 'web', caps: caps({ image: false }) }).reason).toMatch(/images/)
  expect(featureState('sampling', { target: 'ext', caps: caps({ deterministicOnly: true }) }).reason).toMatch(/speculative/)
  expect(featureState('webmcp', { target: 'ext', caps: caps(), pageToolCount: 0 }).reason).toMatch(/doesn’t expose/)
})

it('declares a limitation for every feature so it can be shown upfront', () => {
  for (const f of FEATURES) expect(f.limitation, f.id).toBeTruthy()
})
