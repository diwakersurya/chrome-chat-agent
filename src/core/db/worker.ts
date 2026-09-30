/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as repo from './repo'

// opfs-sahpool needs no COOP/COEP headers (GitHub Pages can't set them) and
// works in extension pages. If OPFS is unavailable (or another tab holds the
// pool) we fall back to an in-memory DB so chat keeps working.
// After a reload the previous page's worker can still hold the OPFS access
// handles for a moment; retry before giving up on persistence.
async function openPool(sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ name: 'local-chat-agent' })
    } catch (err) {
      const locked = err instanceof Error && /Access Handle|NoModificationAllowed|locked/i.test(`${err.name} ${err.message}`)
      if (!locked || attempt >= 8) throw err
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
    }
  }
}

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule()
  try {
    const pool = await openPool(sqlite3)
    const db = new pool.OpfsSAHPoolDb('/chat.sqlite3') as unknown as repo.Db
    repo.migrate(db)
    return { db, persistent: true as const, reason: '' }
  } catch (err) {
    const db = new sqlite3.oo1.DB(':memory:') as unknown as repo.Db
    repo.migrate(db)
    const reason = err instanceof Error ? err.message : String(err)
    return { db, persistent: false as const, reason }
  }
})()

const WRITES = new Set([
  'createConversation',
  'renameConversation',
  'deleteConversation',
  'saveMessages',
  'setSetting',
  'importAll',
  'clearAll',
])

self.onmessage = async (e: MessageEvent<{ id: number; fn: string; args: unknown[] }>) => {
  const { id, fn, args } = e.data
  try {
    const state = await ready
    if (fn === '__status') {
      self.postMessage({ id, result: { persistent: state.persistent, reason: state.reason } })
      return
    }
    const f = (repo as unknown as Record<string, (db: repo.Db, ...a: unknown[]) => unknown>)[fn]
    if (!f) throw new Error(`Unknown db function ${fn}`)
    const result = f(state.db, ...args)
    self.postMessage({ id, result })
    if (WRITES.has(fn)) self.postMessage({ type: 'change', tables: result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
