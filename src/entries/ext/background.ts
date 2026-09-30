import { PENDING_KEY } from '../../platform/extension'

const MENU_ID = 'ask-about-selection'

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Ask Local Chat Agent about “%s”', contexts: ['selection'] })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.windowId) return
  // open() must run synchronously inside the user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error)
  void chrome.storage.session.set({
    [PENDING_KEY]: { title: tab.title ?? '', url: tab.url ?? '', text: '', selection: info.selectionText ?? '' },
  })
})
