import { outputLanguage } from './capabilities'

// Thin wrappers over Chrome's task-specific APIs. Instances are cached per
// option set because create() is expensive.

const cache = new Map<string, Promise<unknown>>()

function cached<T>(key: string, create: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = create()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

export type SummaryType = 'key-points' | 'tldr' | 'teaser' | 'headline'

export async function summarize(text: string, type: SummaryType = 'tldr', length: 'short' | 'medium' | 'long' = 'medium') {
  const s = await cached(`sum:${type}:${length}`, () =>
    Summarizer.create({ type, length, format: 'markdown', outputLanguage: outputLanguage() }),
  )
  return s.summarize(text)
}

export async function detectLanguage(text: string) {
  const d = await cached('detect', () => LanguageDetector.create())
  const [top] = await d.detect(text)
  return top?.detectedLanguage ?? 'en'
}

export async function translate(text: string, targetLanguage: string, sourceLanguage?: string) {
  const source = sourceLanguage ?? (await detectLanguage(text))
  if (source === targetLanguage) return text
  const t = await cached(`tr:${source}:${targetLanguage}`, () =>
    Translator.create({ sourceLanguage: source, targetLanguage }),
  )
  return t.translate(text)
}

export type RewriteTone = 'more-formal' | 'as-is' | 'more-casual'
export type RewriteLength = 'shorter' | 'as-is' | 'longer'

export async function rewrite(text: string, tone: RewriteTone = 'as-is', length: RewriteLength = 'as-is') {
  const r = await cached(`rw:${tone}:${length}`, () => Rewriter.create({ tone, length, format: 'as-is', outputLanguage: outputLanguage() }))
  return r.rewrite(text)
}

export async function proofread(text: string) {
  const p = await cached('proof', () => Proofreader.create({ expectedInputLanguages: ['en'] }))
  const result = await p.proofread(text)
  return result.correctedInput
}
