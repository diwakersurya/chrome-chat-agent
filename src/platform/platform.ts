import { createContext, useContext } from 'react'

export interface PageContext {
  title: string
  url: string
  text: string
  selection: string
}

/** A tool the current page exposes through WebMCP (document.modelContext). */
export interface PageTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

/** Everything that differs between the web and extension builds. */
export interface Platform {
  target: 'web' | 'ext'
  /** read the active tab (extension only) */
  getPageContext?: () => Promise<PageContext>
  /** WebMCP tools of the active tab; undefined when the page has no WebMCP (extension only) */
  getPageTools?: () => Promise<{ origin: string; tools: PageTool[] }>
  callPageTool?: (name: string, input: unknown) => Promise<unknown>
  /** notifies when the active tab changes or navigates */
  onTabChange?: (cb: () => void) => () => void
  /** selection sent from the context menu, delivered once */
  onPendingSelection?: (cb: (ctx: PageContext) => void) => () => void
}

export const webPlatform: Platform = { target: 'web' }

export const PlatformContext = createContext<Platform>(webPlatform)
export const usePlatform = () => useContext(PlatformContext)
