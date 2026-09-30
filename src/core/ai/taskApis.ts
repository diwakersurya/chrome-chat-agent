import { baseModelOptions, isDeterministicOnly, outputLanguage } from './capabilities'

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

/**
 * Task APIs can be present yet broken (Chrome 154 + Gemma: Summarizer throws
 * "Failed to count tokens"). Fall back to the Prompt API with the same intent.
 */
async function withFallback(
  native: () => Promise<string>,
  instruction: string,
  text: string,
  { ownModel = false } = {},
) {
  // Under Gemma/MTP the Summarizer/Writer/Rewriter fail and a failing Summarizer
  // resets the model service, killing open chat sessions. Don't even try them.
  // (Translator/LanguageDetector use their own models and are unaffected.)
  const skipNative = isDeterministicOnly() && !ownModel
  try {
    if (skipNative) throw new Error('native task API skipped')
    return await native()
  } catch (err) {
    if (!('LanguageModel' in globalThis)) throw err
    const s = await LanguageModel.create({
      ...baseModelOptions(),
      initialPrompts: [{ role: 'system', content: `${instruction} Reply with only the result.` }],
    } as LanguageModelCreateOptions)
    try {
      return await s.prompt(text)
    } finally {
      s.destroy()
    }
  }
}

const SUMMARY_INSTRUCTIONS: Record<string, string> = {
  tldr: 'Summarize the text in a short paragraph.',
  'key-points': 'Summarize the text as a Markdown bullet list of its key points.',
  teaser: 'Write an intriguing one-sentence teaser for the text.',
  headline: 'Write a 3 to 6 word title for the text. No quotes, no trailing punctuation.',
}

export type SummaryType = 'key-points' | 'tldr' | 'teaser' | 'headline'

export async function summarize(text: string, type: SummaryType = 'tldr', length: 'short' | 'medium' | 'long' = 'medium') {
  return withFallback(
    async () => {
      const s = await cached(`sum:${type}:${length}`, () =>
        Summarizer.create({ type, length, format: 'markdown', outputLanguage: outputLanguage() }),
      )
      return s.summarize(text)
    },
    SUMMARY_INSTRUCTIONS[type]!,
    text,
  )
}

export async function detectLanguage(text: string) {
  const d = await cached('detect', () => LanguageDetector.create())
  const [top] = await d.detect(text)
  return top?.detectedLanguage ?? 'en'
}

export async function translate(text: string, targetLanguage: string, sourceLanguage?: string) {
  const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(targetLanguage) ?? targetLanguage
  return withFallback(
    async () => {
      const source = sourceLanguage ?? (await detectLanguage(text))
      if (source === targetLanguage) return text
      const t = await cached(`tr:${source}:${targetLanguage}`, () =>
        Translator.create({ sourceLanguage: source, targetLanguage }),
      )
      return t.translate(text)
    },
    `Translate the text into ${name}.`,
    text,
    { ownModel: true },
  )
}

export type RewriteTone = 'more-formal' | 'as-is' | 'more-casual'
export type RewriteLength = 'shorter' | 'as-is' | 'longer'

export async function rewrite(text: string, tone: RewriteTone = 'as-is', length: RewriteLength = 'as-is') {
  const how = [tone !== 'as-is' && tone.replace('-', ' '), length !== 'as-is' && length].filter(Boolean).join(' and ')
  return withFallback(
    async () => {
      const r = await cached(`rw:${tone}:${length}`, () =>
        Rewriter.create({ tone, length, format: 'as-is', outputLanguage: outputLanguage() }),
      )
      return r.rewrite(text)
    },
    `Rewrite the text to be ${how || 'clearer'}, keeping its meaning.`,
    text,
  )
}

export async function proofread(text: string) {
  return withFallback(
    async () => {
      const p = await cached('proof', () => Proofreader.create({ expectedInputLanguages: ['en'] }))
      return (await p.proofread(text)).correctedInput
    },
    'Fix spelling and grammar mistakes in the text without changing its meaning.',
    text,
  )
}
