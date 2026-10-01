import { beforeEach, describe, expect, it } from 'vitest'
import { configureApprovals, decide, pendingApprovals, requireApproval } from './approval'

const req = { sourceId: 'srv-1', source: 'notes', tool: 'notes_add', args: {} }

describe('approvals', () => {
  beforeEach(() => configureApprovals([], () => {}))

  it('skips the card for read-only tools and always-allowed tools', async () => {
    await requireApproval({ ...req, readOnly: true })
    configureApprovals(['srv-1/notes_add'], () => {})
    await requireApproval(req)
    expect(pendingApprovals()).toEqual([])
  })

  it('keys "always allow" by source id, not display name', async () => {
    let saved: string[] = []
    configureApprovals([], (k) => (saved = k))
    const p = requireApproval(req)
    decide(pendingApprovals()[0]!.id, 'always')
    await p
    expect(saved).toEqual(['srv-1/notes_add'])
    // a different server reusing the name still asks
    const q = requireApproval({ ...req, sourceId: 'srv-2' })
    expect(pendingApprovals()).toHaveLength(1)
    decide(pendingApprovals()[0]!.id, 'deny')
    await expect(q).rejects.toThrow(/declined/)
  })

  it('never shows a card for an already-stopped turn, and clears it when stopped later', async () => {
    const stopped = AbortSignal.abort()
    await expect(requireApproval(req, stopped)).rejects.toThrow(/Stopped/)
    expect(pendingApprovals()).toEqual([])

    const ac = new AbortController()
    const p = requireApproval(req, ac.signal)
    expect(pendingApprovals()).toHaveLength(1)
    ac.abort()
    await expect(p).rejects.toThrow(/declined/)
    expect(pendingApprovals()).toEqual([])
  })
})
