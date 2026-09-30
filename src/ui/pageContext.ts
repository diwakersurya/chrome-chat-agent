import type { PageContext } from '../platform/platform'

// Page context travels as a normal text part so the model sees it and it
// survives persistence; the UI recognises the wrapper and renders a chip.

const esc = (s: string) => s.replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&quot;/g, '"')

export const PAGE_TEXT_LIMIT = 8000

export function formatPageContext(ctx: PageContext, body: string) {
  return `<page title="${esc(ctx.title)}" url="${esc(ctx.url)}">\n${body}\n</page>`
}

export function parsePageContext(text: string) {
  const m = /^<page title="([^"]*)" url="([^"]*)">\n([\s\S]*)\n<\/page>$/.exec(text)
  return m ? { title: unesc(m[1]!), url: unesc(m[2]!), body: m[3]! } : undefined
}
