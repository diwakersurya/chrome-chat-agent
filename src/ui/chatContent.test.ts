import { describe, expect, it } from 'vitest'
import type { UIMessage } from '@tanstack/ai-react'
import { draftToContent, fromStored, isBlankAssistant, messageText, toStored, userContent } from './chatContent'
import { friendlyError } from './errors'
import { conversationsToMarkdown } from './exportMarkdown'
import { formatPageContext, parsePageContext } from './pageContext'

const page = { title: 'Docs "v2"', url: 'https://x.dev/a', text: '', selection: '' }

describe('chat content', () => {
  it('round-trips stored messages', () => {
    const m: UIMessage = { id: 'm1', role: 'assistant', parts: [{ type: 'text', content: 'hi' }], metadata: { task: 'T' }, createdAt: new Date(5) }
    expect(fromStored(toStored(m))).toEqual(m)
  })

  it('builds sendable content from a draft and keeps wrappers on resend', () => {
    const skill = { id: 's', name: 'pirate', description: 'd', body: 'Talk like a pirate', enabled: true, source: 'x', updatedAt: 0 }
    expect(draftToContent({ text: 'hello', attachments: [], skills: [] })).toBe('hello')
    const c = draftToContent({
      text: 'hi',
      skills: [skill],
      page: { ...page, body: 'page body' },
      attachments: [{ kind: 'image', mimeType: 'image/png', data: 'AAA', name: 'a.png' }],
    })
    if (typeof c === 'string' || typeof c.content === 'string') throw new Error('expected parts')
    expect(c.content.map((p) => p.type)).toEqual(['text', 'text', 'image', 'text'])

    const sent: UIMessage = { id: 'u', role: 'user', parts: c.content as UIMessage['parts'] }
    expect(messageText(sent)).toBe('hi')
    const edited = userContent(sent, 'hi again').content
    if (typeof edited === 'string') throw new Error('expected parts')
    expect(edited.map((p) => (p.type === 'text' ? p.content.slice(0, 7) : p.type))).toEqual(['<skill ', '<page t', 'image', 'hi agai'])
  })

  it('hides blank assistant turns', () => {
    expect(isBlankAssistant({ id: 'a', role: 'assistant', parts: [{ type: 'text', content: '  ' }] })).toBe(true)
    expect(isBlankAssistant({ id: 'b', role: 'assistant', parts: [{ type: 'text', content: 'ok' }] })).toBe(false)
  })

  it('formats and parses page context with quotes in the title', () => {
    expect(parsePageContext(formatPageContext(page, 'body\nline'))).toEqual({ title: 'Docs "v2"', url: 'https://x.dev/a', body: 'body\nline' })
  })

  it('exports markdown without leaking skill instructions', () => {
    const md = conversationsToMarkdown([
      {
        id: 'c',
        title: 'Trip',
        createdAt: 0,
        updatedAt: 0,
        messages: [
          { id: '1', role: 'user', parts: [{ type: 'text', content: '<skill name="pirate">\nsecret\n</skill>' }, { type: 'text', content: 'plan it' }], createdAt: 0 },
          { id: '2', role: 'assistant', parts: [{ type: 'text', content: 'Done' }], createdAt: 0 },
        ],
      },
    ])
    expect(md).toContain('_Used skill pirate_')
    expect(md).not.toContain('secret')
    expect(md).toContain('**Assistant:**\n\nDone')
  })

  it('turns model errors into plain language', () => {
    expect(friendlyError(new DOMException('The input is too large.', 'QuotaExceededError'))).toMatch(/too long/)
    expect(friendlyError(new Error('The model execution session has been destroyed.'))).toMatch(/restarted/)
    expect(friendlyError(new Error('Custom thing'))).toBe('Custom thing')
  })
})
