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

export interface PageTools {
  tabId: number
  origin: string
  tools: PageTool[]
}

/** Everything that differs between the web and extension builds. */
export interface Platform {
  target: 'web' | 'ext'
  /** read the active tab (extension only) */
  getPageContext?: () => Promise<PageContext>
  /** WebMCP tools of the active tab (extension only); `tabId` + `origin` bind later calls to that page */
  getPageTools?: () => Promise<PageTools>
  /** runs only if tab `tabId` is still showing `origin` */
  callPageTool?: (target: { tabId: number; origin: string }, name: string, input: unknown) => Promise<unknown>
  /** notifies when the active tab changes or navigates */
  onTabChange?: (cb: () => void) => () => void
  /** selection sent from the context menu, delivered once */
  onPendingSelection?: (cb: (ctx: PageContext) => void) => () => void
}

export const webPlatform: Platform = { target: 'web' }

export const PlatformContext = createContext<Platform>(webPlatform)
export const usePlatform = () => useContext(PlatformContext)
