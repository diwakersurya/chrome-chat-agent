// Scriptable stand-in for Chrome's LanguageModel, used by tests only.

export interface FakeScript {
  /** replies for prompt() (router decisions), consumed in order */
  prompts: string[]
  /** replies for promptStreaming(), consumed in order; each is split into chunks */
  streams: string[]
}

export interface FakeLog {
  created: { initialPrompts: unknown[] }[]
  appended: unknown[][]
  prompted: unknown[][]
}

export function installFakeLanguageModel(script: FakeScript, window = 4096) {
  const log: FakeLog = { created: [], appended: [], prompted: [] }

  class FakeSession {
    contextUsage = 0
    contextWindow = window
    constructor(public history: unknown[]) {
      this.contextUsage = JSON.stringify(history).length / 4
    }
    async prompt(input: unknown[]) {
      log.prompted.push(input)
      const r = script.prompts.shift()
      if (r == null) throw new Error('fake: no scripted prompt reply')
      return r
    }
    promptStreaming(input: unknown[]) {
      log.prompted.push(input)
      const text = script.streams.shift()
      if (text == null) throw new Error('fake: no scripted stream reply')
      this.history.push(...input, { role: 'assistant', content: text })
      const chunks = text.match(/.{1,4}/gs) ?? []
      return new ReadableStream<string>({
        start(c) {
          chunks.forEach((ch) => c.enqueue(ch))
          c.close()
        },
      })
    }
    async append(msgs: unknown[]) {
      log.appended.push(msgs)
      this.history.push(...msgs)
    }
    async measureContextUsage(input: unknown) {
      return JSON.stringify(input).length / 4
    }
    async clone() {
      return new FakeSession([...this.history])
    }
    destroy() {}
  }

  ;(globalThis as any).LanguageModel = {
    availability: async () => 'available',
    create: async (o: { initialPrompts?: unknown[] } = {}) => {
      log.created.push({ initialPrompts: o.initialPrompts ?? [] })
      return new FakeSession([...(o.initialPrompts ?? [])])
    },
  }
  return log
}
