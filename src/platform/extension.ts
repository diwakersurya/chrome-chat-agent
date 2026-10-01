import type { PageContext, PageTool, PageTools, Platform } from './platform'

export const PENDING_KEY = 'pendingSelection'

async function getPageContext(): Promise<PageContext> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('No active tab')
  if (!/^https?:|^file:/.test(tab.url ?? '')) throw new Error(`Can't read this page (${tab.url ?? 'unknown'})`)
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title,
      url: location.href,
      text: document.body?.innerText ?? '',
      selection: getSelection()?.toString() ?? '',
    }),
  })
  if (!res?.result) throw new Error('Could not read the page')
  return res.result as PageContext
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !/^https?:|^file:/.test(tab.url ?? '')) return undefined
  return tab as chrome.tabs.Tab & { id: number }
}

// WebMCP tools live in the page's own JS world, so these run with world: 'MAIN'.
async function getPageTools(): Promise<PageTools> {
  const tab = await activeTab()
  if (!tab) return { tabId: -1, origin: '', tools: [] }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async () => {
      const mc = document.modelContext
      if (!mc?.getTools) return []
      const tools = await mc.getTools()
      return tools.map((t) => ({
        name: String(t.name),
        description: String(t.description ?? ''),
        inputSchema: JSON.parse(JSON.stringify(t.inputSchema ?? { type: 'object' })),
        readOnly: t.annotations?.readOnlyHint === true,
      }))
    },
  })
  return { tabId: tab.id, origin: new URL(tab.url!).origin, tools: (res?.result ?? []) as PageTool[] }
}

async function callPageTool(target: { tabId: number; origin: string }, name: string, input: unknown) {
  // the tool belongs to the page it was listed on; refuse if that tab has moved elsewhere
  const tab = await chrome.tabs.get(target.tabId).catch(() => undefined)
  const origin = tab?.url && /^https?:|^file:/.test(tab.url) ? new URL(tab.url).origin : undefined
  if (origin !== target.origin) throw new Error(`The page that offered “${name}” (${target.origin}) is no longer open in that tab.`)
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: target.tabId },
    world: 'MAIN',
    args: [name, input as never],
    func: async (toolName: string, args: unknown) => {
      try {
        const mc = document.modelContext
        if (!mc?.getTools || !mc.executeTool) return { ok: false, error: 'This page no longer offers WebMCP tools.' }
        const tool = (await mc.getTools()).find((t) => t.name === toolName)
        if (!tool) return { ok: false, error: `This page no longer offers the tool “${toolName}”.` }
        return { ok: true, value: await mc.executeTool(tool, args) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })
  const r = res?.result as { ok: boolean; value?: unknown; error?: string } | undefined
  if (!r?.ok) throw new Error(r?.error ?? 'The page tool failed.')
  try {
    return typeof r.value === 'string' ? JSON.parse(r.value) : r.value
  } catch {
    return r.value
  }
}

function onTabChange(cb: () => void) {
  const onActivated = () => cb()
  const onUpdated = (_: number, info: chrome.tabs.OnUpdatedInfo) => info.status === 'complete' && cb()
  chrome.tabs.onActivated.addListener(onActivated)
  chrome.tabs.onUpdated.addListener(onUpdated)
  return () => {
    chrome.tabs.onActivated.removeListener(onActivated)
    chrome.tabs.onUpdated.removeListener(onUpdated)
  }
}

function onPendingSelection(cb: (ctx: PageContext) => void) {
  const take = async () => {
    const { [PENDING_KEY]: v } = await chrome.storage.session.get(PENDING_KEY)
    if (!v) return
    await chrome.storage.session.remove(PENDING_KEY)
    cb(v as PageContext)
  }
  take()
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[PENDING_KEY]?.newValue) take()
  }
  chrome.storage.session.onChanged.addListener(listener)
  return () => chrome.storage.session.onChanged.removeListener(listener)
}

export const extensionPlatform: Platform = {
  target: 'ext',
  getPageContext,
  getPageTools,
  callPageTool,
  onTabChange,
  onPendingSelection,
}
