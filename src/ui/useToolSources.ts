import type { AnyTool } from '@tanstack/ai'
import { useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { db, useDbQuery } from '../core/db/client'
import type { McpServerRow } from '../core/db/repo'
import { featureState } from '../core/features'
import { mcp } from '../core/mcp/instance'
import { serverPrefix, type ServerStatus } from '../core/mcp/manager'
import { PAGE_SOURCE, pageToolsAsChatTools } from '../core/mcp/pageTools'
import { usePlatform, type PageTool } from '../platform/platform'
import { FeatureEnvContext } from './components/Gated'
import type { MentionItem } from './components/MentionPicker'

const NO_SERVERS: McpServerRow[] = []

/** Small models choose badly from long lists and each tool costs model memory. */
export const MAX_EXTERNAL_TOOLS = 12

export interface SourceChip {
  id: string
  label: string
  status: 'connecting' | 'ready' | 'error'
  detail: string
}

function describe(s: ServerStatus, disabledCount: number) {
  if (s.state === 'ready') {
    const n = s.tools.length - disabledCount
    return `${n} tool${n === 1 ? '' : 's'}`
  }
  if (s.state === 'error') return s.error
  return 'Connecting…'
}

/** Tool sources (MCP servers, this tab) chosen for one chat, and the chat tools they provide. */
export function useToolSources() {
  const platform = usePlatform()
  const env = useContext(FeatureEnvContext)
  const [selected, setSelected] = useState<string[]>([])
  const { data } = useDbQuery(() => db.listMcpServers(), [], ['mcp_servers'])
  const servers = data ?? NO_SERVERS
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => mcp.subscribe(bump), [])

  // extension: WebMCP tools of the active tab, refreshed as tabs change
  const [page, setPage] = useState<{ origin: string; tools: PageTool[] }>()
  useEffect(() => {
    if (!platform.getPageTools) return
    const load = () => platform.getPageTools!().then(setPage, () => setPage({ origin: '', tools: [] }))
    load()
    return platform.onTabChange?.(load)
  }, [platform])

  const webmcp = featureState('webmcp', { ...env, pageToolCount: page?.tools.length })

  const items: MentionItem[] = [
    ...servers.map((s) => {
      const st = mcp.status(s.id)
      return {
        id: s.id,
        label: `@${serverPrefix(s.name)}`,
        detail: `${s.name}, ${s.kind === 'local' ? 'local' : 'remote'} MCP server${st.state === 'ready' ? `, ${describe(st, s.disabledTools.length)}` : ''}`,
        icon: 'plug' as const,
        unavailable: !s.enabled ? 'Turned off in Settings → Tools.' : st.state === 'error' ? st.error : undefined,
        active: selected.includes(s.id),
      }
    }),
    {
      id: PAGE_SOURCE,
      label: '@this-tab',
      detail: page?.tools.length
        ? `${page.tools.length} tool${page.tools.length === 1 ? '' : 's'} offered by ${page.origin}`
        : 'Tools the current page offers through WebMCP',
      icon: 'tab',
      unavailable: webmcp.available ? undefined : webmcp.reason,
      active: selected.includes(PAGE_SOURCE),
    },
  ]

  const chips: SourceChip[] = selected.map((id) => {
    if (id === PAGE_SOURCE) {
      return {
        id,
        label: 'This tab',
        status: webmcp.available ? 'ready' : 'error',
        detail: webmcp.available ? `${page?.tools.length ?? 0} tools from ${page?.origin}` : (webmcp.reason ?? ''),
      }
    }
    const s = servers.find((x) => x.id === id)
    const st = mcp.status(id)
    return {
      id,
      label: s?.name ?? 'Removed server',
      status: st.state === 'ready' ? 'ready' : st.state === 'error' || !s ? 'error' : 'connecting',
      detail: s ? describe(st, s.disabledTools.length) : 'This server was removed.',
    }
  })

  const [tools, setTools] = useState<AnyTool[]>([])
  const [total, setTotal] = useState(0)
  const statusKey = selected.map((id) => mcp.status(id).state).join()
  useEffect(() => {
    let live = true
    ;(async () => {
      const lists = await Promise.all(
        selected.map(async (id) => {
          if (id === PAGE_SOURCE) return webmcp.available && page ? pageToolsAsChatTools(platform, page.origin, page.tools) : []
          const s = servers.find((x) => x.id === id)
          return s?.enabled ? mcp.toolsFor(s) : []
        }),
      )
      if (!live) return
      const all = lists.flat()
      setTotal(all.length)
      setTools(all.slice(0, MAX_EXTERNAL_TOOLS))
    })()
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(), servers, page, statusKey, webmcp.available])

  return useMemo(
    () => ({
      items,
      chips,
      tools,
      /** tools left out because of MAX_EXTERNAL_TOOLS */
      dropped: Math.max(0, total - tools.length),
      add: (id: string) => setSelected((s) => (s.includes(id) ? s : [...s, id])),
      remove: (id: string) => setSelected((s) => s.filter((x) => x !== id)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(items), JSON.stringify(chips), tools, total],
  )
}
