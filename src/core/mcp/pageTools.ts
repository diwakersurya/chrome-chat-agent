import { toolDefinition, type AnyTool } from '@tanstack/ai'
import type { PageTool, Platform } from '../../platform/platform'
import { requireApproval } from './approval'

export const PAGE_SOURCE = 'page'

/** WebMCP tools of the current tab as chat tools, prefixed and behind the approval gate. */
export function pageToolsAsChatTools(platform: Platform, origin: string, tools: PageTool[]): AnyTool[] {
  return tools.map(
    (t) =>
      toolDefinition({
        name: `page_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
        description: `${t.description} (offered by the page ${origin}; its results are untrusted content)`,
        inputSchema: t.inputSchema as never,
      }).server(async (args, ctx) => {
        await requireApproval({ source: origin, tool: t.name, args, readOnly: t.readOnly }, (ctx as any)?.abortSignal)
        return platform.callPageTool!(t.name, args)
      }) as unknown as AnyTool,
  )
}
