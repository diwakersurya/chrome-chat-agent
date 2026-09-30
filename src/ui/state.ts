import { useCallback, useEffect, useState } from 'react'
import { detectCapabilities, type Capabilities } from '../core/ai/capabilities'
import { db, useDbQuery } from '../core/db/client'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  systemPrompt: string
  temperature: number | null
  topK: number | null
  toolsEnabled: boolean
  disabledTools: string[]
  theme: Theme
  /** "source/tool" keys the user chose to always allow */
  mcpAlwaysAllow: string[]
  /** the "What works here" overview was shown once */
  seenCapabilities: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt:
    'You are a helpful, concise assistant running fully on the user’s device. Use Markdown for structure and fenced code blocks for code. If you are unsure, say so.',
  temperature: null,
  topK: null,
  toolsEnabled: true,
  disabledTools: [],
  theme: 'system',
  mcpAlwaysAllow: [],
  seenCapabilities: false,
}

export function useSettings() {
  const { data } = useDbQuery(() => db.getSettings(), [], ['settings'])
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(data as Partial<Settings> | undefined) }
  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => db.setSetting(key, value), [])
  return { settings, loaded: data !== undefined, update }
}

export function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities>()
  const refresh = useCallback(() => detectCapabilities().then(setCaps), [])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { caps, refresh }
}

export function useDbStatus() {
  const [status, setStatus] = useState<{ persistent: boolean; reason: string }>()
  useEffect(() => {
    db.status().then(setStatus, (e: Error) => setStatus({ persistent: false, reason: e.message }))
  }, [])
  return status
}
