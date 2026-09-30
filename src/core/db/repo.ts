// All SQL lives here. Pure functions over a minimal DB handle so they run
// unchanged in the OPFS worker and against an in-memory DB in tests.

export interface Db {
  exec(sql: string, opts?: { bind?: unknown[] }): unknown
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[]
  transaction<T>(fn: (db: Db) => T): T
}

export type Table = 'conversations' | 'messages' | 'settings'

export interface ConversationRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface StoredMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  parts: unknown[]
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface SearchHit {
  conversationId: string
  title: string
  snippet: string
}

export interface ExportedConversation extends ConversationRow {
  messages: StoredMessage[]
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    metadata TEXT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_by_conversation ON messages(conversation_id, seq);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid');
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  `,
]

export function migrate(db: Db) {
  db.exec('PRAGMA foreign_keys = ON')
  const [{ user_version }] = db.selectObjects('PRAGMA user_version') as [{ user_version: number }]
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.transaction((tx) => {
      tx.exec(MIGRATIONS[v]!)
      tx.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Plain text of a message for search: text parts (markdown syntax stripped) and tool names. */
export function messageText(parts: unknown[]): string {
  return parts
    .map((p: any) => (p?.type === 'text' ? p.content : p?.type === 'tool-call' ? `[${p.name}]` : ''))
    .filter(Boolean)
    .join('\n')
    .replace(/<page [^>]*>|<\/page>/g, ' ')
    .replace(/```\w*|[|*_`#>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const conv = (r: Record<string, unknown>): ConversationRow => ({
  id: r.id as string,
  title: r.title as string,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
})

// ---------- reads ----------

export function listConversations(db: Db): ConversationRow[] {
  return db.selectObjects('SELECT * FROM conversations ORDER BY updated_at DESC').map(conv)
}

export function getMessages(db: Db, conversationId: string): StoredMessage[] {
  return db
    .selectObjects('SELECT id, role, parts, metadata, created_at FROM messages WHERE conversation_id = ? ORDER BY seq', [
      conversationId,
    ])
    .map((r) => ({
      id: r.id as string,
      role: r.role as StoredMessage['role'],
      parts: JSON.parse(r.parts as string),
      ...(r.metadata ? { metadata: JSON.parse(r.metadata as string) } : {}),
      createdAt: r.created_at as number,
    }))
}

/** FTS query from free text: every token must match as a prefix. */
export function ftsQuery(q: string) {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ')
}

export function search(db: Db, q: string, limit = 30): SearchHit[] {
  const query = ftsQuery(q)
  if (!query) return []
  const like = `%${q.trim()}%`
  const byTitle = db.selectObjects('SELECT id, title FROM conversations WHERE title LIKE ? ORDER BY updated_at DESC', [
    like,
  ])
  const byText = db.selectObjects(
    `SELECT m.conversation_id AS id, c.title AS title,
            snippet(messages_fts, 0, '«', '»', '…', 12) AS snippet
     FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
     JOIN conversations c ON c.id = m.conversation_id
     WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`,
    [query, limit],
  )
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const r of [...byTitle, ...byText]) {
    if (seen.has(r.id as string)) continue
    seen.add(r.id as string)
    hits.push({ conversationId: r.id as string, title: r.title as string, snippet: (r.snippet as string) ?? '' })
  }
  return hits.slice(0, limit)
}

export function getSettings(db: Db): Record<string, unknown> {
  return Object.fromEntries(
    db.selectObjects('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value as string)]),
  )
}

export function exportAll(db: Db): ExportedConversation[] {
  return listConversations(db).map((c) => ({ ...c, messages: getMessages(db, c.id) }))
}

// ---------- writes (return the tables they touched) ----------

export function createConversation(db: Db, id: string, title: string, now = Date.now()): Table[] {
  db.exec('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', {
    bind: [id, title, now, now],
  })
  return ['conversations']
}

export function renameConversation(db: Db, id: string, title: string): Table[] {
  db.exec('UPDATE conversations SET title = ? WHERE id = ?', { bind: [title, id] })
  return ['conversations']
}

export function deleteConversation(db: Db, id: string): Table[] {
  db.exec('DELETE FROM conversations WHERE id = ?', { bind: [id] })
  return ['conversations', 'messages']
}

/** Replace a conversation's messages wholesale. Handles edits/regenerate truncation for free. */
export function saveMessages(db: Db, conversationId: string, messages: StoredMessage[], now = Date.now()): Table[] {
  db.transaction((tx) => writeMessages(tx, conversationId, messages, now))
  return ['conversations', 'messages']
}

function writeMessages(db: Db, conversationId: string, messages: StoredMessage[], now: number) {
  db.exec('DELETE FROM messages WHERE conversation_id = ?', { bind: [conversationId] })
  messages.forEach((m, seq) => {
    db.exec(
      'INSERT INTO messages (id, conversation_id, seq, role, parts, metadata, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      {
        bind: [
          m.id,
          conversationId,
          seq,
          m.role,
          JSON.stringify(m.parts),
          m.metadata ? JSON.stringify(m.metadata) : null,
          messageText(m.parts),
          m.createdAt,
        ],
      },
    )
  })
  db.exec('UPDATE conversations SET updated_at = ? WHERE id = ?', { bind: [now, conversationId] })
}

export function setSetting(db: Db, key: string, value: unknown): Table[] {
  db.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', {
    bind: [key, JSON.stringify(value)],
  })
  return ['settings']
}

export function importAll(db: Db, data: ExportedConversation[]): Table[] {
  db.transaction((tx) => {
    for (const c of data) {
      tx.exec(
        `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        { bind: [c.id, c.title, c.createdAt, c.updatedAt] },
      )
      writeMessages(tx, c.id, c.messages, c.updatedAt)
    }
  })
  return ['conversations', 'messages']
}

export function clearAll(db: Db): Table[] {
  db.transaction((tx) => {
    tx.exec('DELETE FROM conversations')
    tx.exec('DELETE FROM settings')
  })
  return ['conversations', 'messages', 'settings']
}
