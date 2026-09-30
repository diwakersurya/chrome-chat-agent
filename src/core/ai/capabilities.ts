// Runtime feature detection for Chrome built-in AI. Every feature is detected
// on its own so a missing API only hides its own UI.

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export interface Capabilities {
  prompt: Availability
  image: boolean
  audio: boolean
  /** temperature/topK are honoured in extensions only, and not with speculative decoding */
  sampling: boolean
  /** the model only runs with deterministic sampling (e.g. Gemma 4 with MTP in Chrome 154+) */
  deterministicOnly: boolean
  summarizer: Availability
  translator: boolean
  languageDetector: Availability
  writer: Availability
  rewriter: Availability
  proofreader: Availability
}

const has = (name: string) => name in globalThis

// Nano currently attests output safety for these; declaring one avoids Chrome's warning.
const OUTPUT_LANGS = ['en', 'es', 'ja']
export const outputLanguage = () => {
  const lang = (globalThis.navigator?.language ?? 'en').slice(0, 2)
  return OUTPUT_LANGS.includes(lang) ? lang : 'en'
}
export const expectedOutputs = () => [{ type: 'text' as const, languages: [outputLanguage()] }]

// Chrome 154's Gemma 4 backend uses speculative decoding (MTP) and reports
// "unavailable" unless sessions ask for deterministic sampling. We probe once
// and then send the same sampling options with every availability()/create().
const DETERMINISTIC = { samplingMode: 'most-predictable' } as const
let requiredSampling: Partial<typeof DETERMINISTIC> = {}

/** Options every LanguageModel.availability()/create() call must include. */
export const baseModelOptions = () => ({ expectedOutputs: expectedOutputs(), ...requiredSampling })
export const isDeterministicOnly = () => 'samplingMode' in requiredSampling

async function safe(fn: () => Promise<Availability>): Promise<Availability> {
  try {
    return await fn()
  } catch {
    return 'unavailable'
  }
}

const multimodal = (type: 'image' | 'audio') =>
  safe(() => LanguageModel.availability({ expectedInputs: [{ type }], ...baseModelOptions() } as never)).then(
    (a) => a !== 'unavailable',
  )

async function detectPrompt(): Promise<Availability> {
  if (!has('LanguageModel')) return 'unavailable'
  requiredSampling = {}
  const plain = await safe(() => LanguageModel.availability(baseModelOptions()))
  if (plain !== 'unavailable') return plain
  const deterministic = await safe(() =>
    LanguageModel.availability({ expectedOutputs: expectedOutputs(), ...DETERMINISTIC } as never),
  )
  if (deterministic !== 'unavailable') requiredSampling = DETERMINISTIC
  return deterministic
}

export async function detectCapabilities(): Promise<Capabilities> {
  const prompt = await detectPrompt()
  const ok = prompt !== 'unavailable'
  const [image, audio, summarizer, languageDetector, writer, rewriter, proofreader] = await Promise.all([
    ok ? multimodal('image') : false,
    ok ? multimodal('audio') : false,
    has('Summarizer') ? safe(() => Summarizer.availability({ outputLanguage: outputLanguage() })) : ('unavailable' as const),
    has('LanguageDetector') ? safe(() => LanguageDetector.availability()) : ('unavailable' as const),
    has('Writer') ? safe(() => Writer.availability({ outputLanguage: outputLanguage() })) : ('unavailable' as const),
    has('Rewriter') ? safe(() => Rewriter.availability({ outputLanguage: outputLanguage() })) : ('unavailable' as const),
    has('Proofreader') ? safe(() => Proofreader.availability()) : ('unavailable' as const),
  ])
  return {
    prompt,
    image,
    audio,
    sampling: __TARGET__ === 'ext' && ok && !isDeterministicOnly(),
    deterministicOnly: isDeterministicOnly(),
    summarizer,
    translator: has('Translator'),
    languageDetector,
    writer,
    rewriter,
    proofreader,
  }
}

export const usable = (a: Availability) => a !== 'unavailable'
