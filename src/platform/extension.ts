import type { PageContext, Platform } from './platform'

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

export const extensionPlatform: Platform = { target: 'ext', getPageContext, onPendingSelection }
