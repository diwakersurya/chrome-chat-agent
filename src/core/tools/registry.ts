import { toolDefinition, type AnyTool } from '@tanstack/ai'
import { z } from 'zod'
import type { Capabilities } from '../ai/capabilities'
import { usable } from '../ai/capabilities'
import * as task from '../ai/taskApis'
import type { DbClient } from '../db/client'
import type { Platform } from '../../platform/platform'
import { calculate } from './calc'

// Single registry: every agent tool is declared here once. Tools run in the
// browser (chat() executes `.server()` impls in-process — there is no server).

const MAX_PAGE_CHARS = 6000

export interface ToolMeta {
  name: string
  label: string
  description: string
  /** why this tool can't run here (it is still listed, disabled) */
  unavailable?: string
}

interface Env {
  caps: Capabilities
  platform: Platform
  db: DbClient
}

const readTab = (env: Env) =>
  toolDefinition({
    name: 'read_tab',
    description: 'Read the title, URL, selected text and visible text of the browser tab the user is looking at.',
    inputSchema: z.object({}),
  }).server(async () => {
    const page = await env.platform.getPageContext!()
    return { ...page, text: page.text.slice(0, MAX_PAGE_CHARS), truncated: page.text.length > MAX_PAGE_CHARS }
  })

const searchHistory = (env: Env) =>
  toolDefinition({
    name: 'search_history',
    description: "Search the user's past conversations for a keyword or phrase.",
    inputSchema: z.object({ query: z.string() }),
  }).server(async ({ query }) => {
    const hits = await env.db.search(query, 5)
    return hits.length ? hits : 'No matching conversations.'
  })

const summarizeText = () =>
  toolDefinition({
    name: 'summarize_text',
    description: 'Summarize a long piece of text.',
    inputSchema: z.object({
      text: z.string(),
      style: z.enum(['tldr', 'key-points', 'headline']).optional(),
    }),
  }).server(async ({ text, style }) => task.summarize(text, style ?? 'tldr'))

const translateText = () =>
  toolDefinition({
    name: 'translate_text',
    description: 'Translate text into another language. targetLanguage is a BCP-47 code like "fr", "hi", "ja".',
    inputSchema: z.object({ text: z.string(), targetLanguage: z.string() }),
  }).server(async ({ text, targetLanguage }) => task.translate(text, targetLanguage))

const rewriteText = () =>
  toolDefinition({
    name: 'rewrite_text',
    description: 'Rewrite text with a different tone or length.',
    inputSchema: z.object({
      text: z.string(),
      tone: z.enum(['more-formal', 'as-is', 'more-casual']).optional(),
      length: z.enum(['shorter', 'as-is', 'longer']).optional(),
    }),
  }).server(async ({ text, tone, length }) => task.rewrite(text, tone, length))

const proofreadText = () =>
  toolDefinition({
    name: 'proofread_text',
    description: 'Fix grammar and spelling mistakes in text.',
    inputSchema: z.object({ text: z.string() }),
  }).server(async ({ text }) => task.proofread(text))

const calc = () =>
  toolDefinition({
    name: 'calculate',
    description: 'Evaluate a maths expression exactly, e.g. "(12.5 * 4) / 3" or "sqrt(2) * 15%".',
    inputSchema: z.object({ expression: z.string() }),
  }).server(async ({ expression }) => ({ expression, result: calculate(expression) }))

const datetime = () =>
  toolDefinition({
    name: 'get_datetime',
    description: 'Get the current date, time, weekday and time zone. Optionally for another IANA time zone.',
    inputSchema: z.object({ timeZone: z.string().optional() }),
  }).server(async ({ timeZone }) => {
    const now = new Date()
    const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: tz })
    return { iso: now.toISOString(), local: fmt.format(now), timeZone: tz }
  })

interface Entry {
  meta: ToolMeta
  enabled: (env: Env) => boolean
  make: (env: Env) => AnyTool
}

const ENTRIES: Entry[] = [
  {
    meta: { name: 'read_tab', label: 'Read current tab', description: 'Lets the agent read the page you are on.' },
    enabled: (e) => !!e.platform.getPageContext,
    make: readTab,
  },
  {
    meta: { name: 'search_history', label: 'Search chat history', description: 'Search your past conversations.' },
    enabled: () => true,
    make: searchHistory,
  },
  {
    meta: { name: 'summarize_text', label: 'Summarize', description: 'Chrome Summarizer API.' },
    enabled: (e) => usable(e.caps.prompt) || usable(e.caps.summarizer),
    make: summarizeText,
  },
  {
    meta: { name: 'translate_text', label: 'Translate', description: 'Chrome Translator API.' },
    enabled: (e) => usable(e.caps.prompt) || e.caps.translator,
    make: translateText,
  },
  {
    meta: { name: 'rewrite_text', label: 'Rewrite', description: 'Chrome Rewriter API.' },
    enabled: (e) => usable(e.caps.prompt) || usable(e.caps.rewriter),
    make: rewriteText,
  },
  {
    meta: { name: 'proofread_text', label: 'Proofread', description: 'Chrome Proofreader API.' },
    enabled: (e) => usable(e.caps.prompt) || usable(e.caps.proofreader),
    make: proofreadText,
  },
  {
    meta: { name: 'calculate', label: 'Calculator', description: 'Exact arithmetic.' },
    enabled: () => true,
    make: calc,
  },
  {
    meta: { name: 'get_datetime', label: 'Date & time', description: 'Current date, time and time zone.' },
    enabled: () => true,
    make: datetime,
  },
]

const UNAVAILABLE: Record<string, string> = {
  read_tab: 'Available in the Chrome extension, which can read the tab you’re viewing. Web pages can’t.',
}

/** Every tool, with a reason for those that can't run here (for the settings UI). */
export function allTools(env: Env): ToolMeta[] {
  return ENTRIES.map((t) =>
    t.enabled(env) ? t.meta : { ...t.meta, unavailable: UNAVAILABLE[t.meta.name] ?? 'Needs the on-device model.' },
  )
}

/** Tool implementations for chat(), minus those the user switched off. */
export function buildTools(env: Env, disabled: string[] = []) {
  return ENTRIES.filter((t) => t.enabled(env) && !disabled.includes(t.meta.name)).map((t) => t.make(env))
}
