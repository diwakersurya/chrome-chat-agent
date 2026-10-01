// Shared helpers for reading message content, used by the model layer, the DB
// index and the UI. Content is either a string or an array of parts.

type PartLike = { type?: string; content?: unknown }

/** The text parts of message content, in order. */
export function textParts(content: unknown): string[] {
  if (content == null) return []
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content
    .filter((p: PartLike) => p?.type === 'text' && typeof p.content === 'string')
    .map((p: PartLike) => p.content as string)
}

/** Plain text of message content. */
export const textOf = (content: unknown, separator = '\n') => textParts(content).join(separator)
