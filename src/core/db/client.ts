import { useEffect, useRef, useState } from 'react'
import type * as repo from './repo'
import type { Db, Table } from './repo'

type Repo = typeof repo
type Exposed = Omit<Repo, 'migrate' | 'messageText' | 'ftsQuery'>
export type DbClient = {
  [K in keyof Exposed]: Exposed[K] extends (db: Db, ...a: infer A) => infer R ? (...a: A) => Promise<R> : never
} & { status(): Promise<{ persistent: boolean; reason: string }> }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

const listeners = new Set<(tables: Table[]) => void>()
let worker: Worker | undefined
const pending = new Map<number, Pending>()
let seq = 0

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const d = e.data
    if (d.type === 'change') {
      listeners.forEach((l) => l(d.tables))
      return
    }
    const p = pending.get(d.id)
    if (!p) return
    pending.delete(d.id)
    if ('error' in d) p.reject(new Error(d.error))
    else p.resolve(d.result)
  }
  return worker
}

function call(fn: string, args: unknown[]) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, fn, args })
  })
}

export const db = new Proxy({} as DbClient, {
  get: (_, fn: string) =>
    fn === 'status' ? () => call('__status', []) : (...args: unknown[]) => call(fn, args),
})

export function onDbChange(fn: (tables: Table[]) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Run a DB read and re-run it whenever one of `tables` is written. */
export function useDbQuery<T>(query: () => Promise<T>, deps: unknown[], tables: Table[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const q = useRef(query)
  q.current = query

  useEffect(() => {
    let live = true
    const run = () =>
      q.current().then(
        (d) => live && (setData(d), setError(undefined)),
        (e: Error) => live && setError(e),
      )
    run()
    const off = onDbChange((changed) => changed.some((t) => tables.includes(t)) && run())
    return () => {
      live = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error }
}
