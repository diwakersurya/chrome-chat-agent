// Gaps in @types/dom-chromium-ai that Chrome ships today.
interface LanguageModelParams {
  defaultTopK: number
  maxTopK: number
  defaultTemperature: number
  maxTemperature: number
}

/** WebMCP: tools a page exposes to agents (read in the page's own JS world). */
interface WebMCPPageTool {
  name: string
  description?: string
  inputSchema?: object
  annotations?: { readOnlyHint?: boolean }
}
interface Document {
  modelContext?: {
    getTools?: () => Promise<WebMCPPageTool[]>
    executeTool?: (tool: WebMCPPageTool, input: unknown, options?: { signal?: AbortSignal }) => Promise<string>
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace LanguageModel {
  /** sampling limits; extensions only, absent on web pages */
  const params: (() => Promise<LanguageModelParams>) | undefined
}
