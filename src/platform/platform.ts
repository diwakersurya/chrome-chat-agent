import { createContext, useContext } from 'react'

export interface PageContext {
  title: string
  url: string
  text: string
  selection: string
}

/** Everything that differs between the web and extension builds. */
export interface Platform {
  target: 'web' | 'ext'
  /** read the active tab (extension only) */
  getPageContext?: () => Promise<PageContext>
  /** selection sent from the context menu, delivered once */
  onPendingSelection?: (cb: (ctx: PageContext) => void) => () => void
}

export const webPlatform: Platform = { target: 'web' }

export const PlatformContext = createContext<Platform>(webPlatform)
export const usePlatform = () => useContext(PlatformContext)
