// All SQL lives here. Pure functions over a minimal DB handle so they run
// unchanged in the OPFS worker and against an in-memory DB in tests.

export interface Db {
  exec(sql: string, opts?: { bind?: unknown[] }): unknown
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[]
  transaction<T>(fn: (db: Db) => T): T
}

export type Table = 'conversations' | 'messages' | 'settings' | 'skills' | 'mcp_servers'

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

export interface SkillRow {
  id: string
  name: string
  description: string
  body: string
  enabled: boolean
  /** file name or "manual" */
  source: string
  updatedAt: number
}

export interface McpServerRow {
  id: string
  name: string
  url: string
  transport: 'http' | 'sse'
  kind: 'remote' | 'local'
  /** for local servers: the stdio command the bridge runs */
  command?: string
  /** auth headers; stay in this browser, never exported */
  headers: Record<string, string>
  enabled: boolean
  disabledTools: string[]
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
  `
  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    transport TEXT NOT NULL,
    kind TEXT NOT NULL,
    command TEXT,
    headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    disabled_tools TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
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
    // skill instructions aren't what the user said; page context keeps its body
    .replace(/<skill [^>]*>[\s\S]*?<\/skill>/g, ' ')
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

/**
 * Incremental save: upsert only the messages that changed and delete rows no
 * longer in the conversation (edit/regenerate truncation). `order` is the full
 * list of message ids in display order.
 */
export function syncMessages(
  db: Db,
  conversationId: string,
  changed: StoredMessage[],
  order: string[],
  now = Date.now(),
): Table[] {
  db.transaction((tx) => {
    tx.exec('DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (SELECT value FROM json_each(?))', {
      bind: [conversationId, JSON.stringify(order)],
    })
    for (const m of changed) {
      tx.exec(
        `INSERT INTO messages (id, conversation_id, seq, role, parts, metadata, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, role = excluded.role, parts = excluded.parts,
           metadata = excluded.metadata, text = excluded.text`,
        {
          bind: [
            m.id,
            conversationId,
            order.indexOf(m.id),
            m.role,
            JSON.stringify(m.parts),
            m.metadata ? JSON.stringify(m.metadata) : null,
            messageText(m.parts),
            m.createdAt,
          ],
        },
      )
    }
    tx.exec('UPDATE conversations SET updated_at = ? WHERE id = ?', { bind: [now, conversationId] })
  })
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
    tx.exec('DELETE FROM skills')
    tx.exec('DELETE FROM mcp_servers')
  })
  return ['conversations', 'messages', 'settings', 'skills', 'mcp_servers']
}

// ---------- skills ----------

const skill = (r: Record<string, unknown>): SkillRow => ({
  id: r.id as string,
  name: r.name as string,
  description: r.description as string,
  body: r.body as string,
  enabled: !!r.enabled,
  source: r.source as string,
  updatedAt: r.updated_at as number,
})

export function listSkills(db: Db): SkillRow[] {
  return db.selectObjects('SELECT * FROM skills ORDER BY name').map(skill)
}

/** Insert or replace by name (re-importing a skill updates it). */
export function saveSkill(db: Db, s: Omit<SkillRow, 'updatedAt'>, now = Date.now()): Table[] {
  db.exec(
    `INSERT INTO skills (id, name, description, body, enabled, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description, body = excluded.body,
       enabled = excluded.enabled, source = excluded.source, updated_at = excluded.updated_at`,
    { bind: [s.id, s.name, s.description, s.body, s.enabled ? 1 : 0, s.source, now] },
  )
  return ['skills']
}

export function updateSkill(db: Db, id: string, s: Omit<SkillRow, 'id' | 'updatedAt'>, now = Date.now()): Table[] {
  db.exec('UPDATE skills SET name = ?, description = ?, body = ?, enabled = ?, source = ?, updated_at = ? WHERE id = ?', {
    bind: [s.name, s.description, s.body, s.enabled ? 1 : 0, s.source, now, id],
  })
  return ['skills']
}

export function deleteSkill(db: Db, id: string): Table[] {
  db.exec('DELETE FROM skills WHERE id = ?', { bind: [id] })
  return ['skills']
}

// ---------- MCP servers ----------

const server = (r: Record<string, unknown>): McpServerRow => ({
  id: r.id as string,
  name: r.name as string,
  url: r.url as string,
  transport: r.transport as McpServerRow['transport'],
  kind: r.kind as McpServerRow['kind'],
  ...(r.command ? { command: r.command as string } : {}),
  headers: JSON.parse(r.headers as string),
  enabled: !!r.enabled,
  disabledTools: JSON.parse(r.disabled_tools as string),
})

export function listMcpServers(db: Db): McpServerRow[] {
  return db.selectObjects('SELECT * FROM mcp_servers ORDER BY created_at').map(server)
}

export function saveMcpServer(db: Db, s: McpServerRow, now = Date.now()): Table[] {
  db.exec(
    `INSERT INTO mcp_servers (id, name, url, transport, kind, command, headers, enabled, disabled_tools, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, transport = excluded.transport,
       kind = excluded.kind, command = excluded.command, headers = excluded.headers, enabled = excluded.enabled,
       disabled_tools = excluded.disabled_tools`,
    {
      bind: [
        s.id,
        s.name,
        s.url,
        s.transport,
        s.kind,
        s.command ?? null,
        JSON.stringify(s.headers),
        s.enabled ? 1 : 0,
        JSON.stringify(s.disabledTools),
        now,
      ],
    },
  )
  return ['mcp_servers']
}

export function deleteMcpServer(db: Db, id: string): Table[] {
  db.exec('DELETE FROM mcp_servers WHERE id = ?', { bind: [id] })
  return ['mcp_servers']
}
