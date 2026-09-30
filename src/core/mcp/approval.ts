// External tools (MCP servers, page tools) can change things in the outside
// world. Anything not declared read-only waits for the user's decision.

export interface ApprovalRequest {
  id: string
  source: string
  tool: string
  args: unknown
}

export type Decision = 'once' | 'always' | 'deny'

type Pending = ApprovalRequest & { resolve: (d: Decision) => void }

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()
let alwaysAllowed = new Set<string>()
let onAlways: (keys: string[]) => void = () => {}

const key = (source: string, tool: string) => `${source}/${tool}`
const emit = () => listeners.forEach((l) => l())

/** Load persisted "always allow" choices and a callback to persist new ones. */
export function configureApprovals(keys: string[], persist: (keys: string[]) => void) {
  alwaysAllowed = new Set(keys)
  onAlways = persist
}

export function subscribeApprovals(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const pendingApprovals = (): ApprovalRequest[] => [...pending.values()]

export function decide(id: string, d: Decision) {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  if (d === 'always') {
    alwaysAllowed.add(key(p.source, p.tool))
    onAlways([...alwaysAllowed])
  }
  p.resolve(d)
  emit()
}

/** Resolves when the user allows the call; throws when they deny it or the turn is stopped. */
export async function requireApproval(
  req: Omit<ApprovalRequest, 'id'> & { readOnly?: boolean },
  signal?: AbortSignal,
) {
  if (req.readOnly || alwaysAllowed.has(key(req.source, req.tool))) return
  const id = crypto.randomUUID()
  const decision = await new Promise<Decision>((resolve) => {
    pending.set(id, { ...req, id, resolve })
    signal?.addEventListener('abort', () => decide(id, 'deny'), { once: true })
    emit()
  })
  if (decision === 'deny') throw new Error(`The user declined to run ${req.tool}. Don’t retry it; answer without it.`)
}
