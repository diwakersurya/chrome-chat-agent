import { beforeEach, describe, expect, it } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as repo from './repo'

let db: repo.Db

beforeEach(async () => {
  const sqlite3 = await sqlite3InitModule()
  db = new sqlite3.oo1.DB(':memory:') as unknown as repo.Db
  repo.migrate(db)
})

const msg = (id: string, text: string, role: 'user' | 'assistant' = 'user'): repo.StoredMessage => ({
  id,
  role,
  parts: [{ type: 'text', content: text }],
  createdAt: 1,
})

describe('repo', () => {
  it('migrates idempotently', () => {
    repo.migrate(db)
    expect(db.selectObjects('PRAGMA user_version')[0]!.user_version).toBe(2)
  })

  it('creates, saves, lists and cascades deletes', () => {
    repo.createConversation(db, 'c1', 'First', 10)
    repo.createConversation(db, 'c2', 'Second', 20)
    repo.saveMessages(db, 'c1', [msg('m1', 'hello'), msg('m2', 'hi there', 'assistant')], 30)
    expect(repo.listConversations(db).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(repo.getMessages(db, 'c1').map((m) => m.id)).toEqual(['m1', 'm2'])

    // re-save truncates (regenerate/edit)
    repo.saveMessages(db, 'c1', [msg('m1', 'hello')])
    expect(repo.getMessages(db, 'c1')).toHaveLength(1)

    repo.deleteConversation(db, 'c1')
    expect(db.selectObjects('SELECT count(*) AS n FROM messages')[0]!.n).toBe(0)
  })

  it('full-text searches messages and titles with prefix matching', () => {
    repo.createConversation(db, 'c1', 'Pasta recipes')
    repo.createConversation(db, 'c2', 'Travel')
    repo.saveMessages(db, 'c2', [msg('m1', 'Best trains between Tokyo and Kyoto')])
    expect(repo.search(db, 'kyo').map((h) => h.conversationId)).toEqual(['c2'])
    expect(repo.search(db, 'pasta').map((h) => h.conversationId)).toEqual(['c1'])
    expect(repo.search(db, 'tokyo kyoto')[0]!.snippet).toContain('«Tokyo»')
    // FTS stays in sync after message deletes
    repo.saveMessages(db, 'c2', [])
    expect(repo.search(db, 'kyoto')).toEqual([])
    // quotes can't break the query
    expect(() => repo.search(db, '"unbalanced')).not.toThrow()
  })

  it('indexes plain text without markdown syntax', () => {
    expect(repo.messageText([{ type: 'text', content: '| Day | Plan |\n|---|---|\n- **Fushimi** `x`' }])).toBe(
      'Day Plan Fushimi x',
    )
  })

  it('round-trips export/import and settings', () => {
    repo.createConversation(db, 'c1', 'One')
    repo.saveMessages(db, 'c1', [msg('m1', 'x')])
    repo.setSetting(db, 'theme', 'dark')
    const dump = repo.exportAll(db)
    repo.clearAll(db)
    expect(repo.listConversations(db)).toEqual([])
    repo.importAll(db, dump)
    expect(repo.exportAll(db)).toEqual(dump)
    expect(repo.getSettings(db)).toEqual({})
    repo.setSetting(db, 'theme', 'light')
    expect(repo.getSettings(db)).toEqual({ theme: 'light' })
  })
})

describe('skills and MCP servers', () => {
  it('upserts skills by name and stores servers without leaking headers into export', () => {
    repo.saveSkill(db, { id: 's1', name: 'review', description: 'Review code', body: 'Do X', enabled: true, source: 'a.md' })
    repo.saveSkill(db, { id: 's2', name: 'review', description: 'Review code v2', body: 'Do Y', enabled: true, source: 'b.md' })
    expect(repo.listSkills(db)).toHaveLength(1)
    expect(repo.listSkills(db)[0]!.body).toBe('Do Y')

    repo.saveMcpServer(db, {
      id: 'm1',
      name: 'github',
      url: 'https://x/mcp',
      transport: 'http',
      kind: 'remote',
      headers: { Authorization: 'Bearer secret' },
      enabled: true,
      disabledTools: ['delete_repo'],
    })
    expect(repo.listMcpServers(db)[0]!.disabledTools).toEqual(['delete_repo'])
    expect(JSON.stringify(repo.exportAll(db))).not.toContain('secret')
    repo.clearAll(db)
    expect(repo.listSkills(db)).toEqual([])
    expect(repo.listMcpServers(db)).toEqual([])
  })
})
