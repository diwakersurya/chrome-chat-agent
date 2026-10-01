import type { ExportedConversation, StoredMessage } from '../core/db/repo'

type PartLike = { type?: string; content?: string; name?: string }

function partText(p: PartLike) {
  if (p.type === 'text') {
    if (p.content?.startsWith('<skill ')) return `_Used skill ${/name="([^"]*)"/.exec(p.content)?.[1] ?? ''}_`
    if (p.content?.startsWith('<page ')) return `_Page: ${/title="([^"]*)"/.exec(p.content)?.[1] ?? ''}_`
    return p.content ?? ''
  }
  if (p.type === 'tool-call') return `_Used ${p.name}_`
  if (p.type === 'image') return '_[image]_'
  if (p.type === 'audio') return '_[voice note]_'
  return ''
}

export function messagesToMarkdown(messages: Pick<StoredMessage, 'role' | 'parts'>[]) {
  return messages
    .map((m) => {
      const text = (m.parts as PartLike[]).map(partText).filter(Boolean).join('\n\n')
      return text ? `**${m.role === 'user' ? 'You' : 'Assistant'}:**\n\n${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

export const conversationsToMarkdown = (data: ExportedConversation[]) =>
  data.map((c) => `# ${c.title}\n\n${messagesToMarkdown(c.messages)}`).join('\n\n\n')
