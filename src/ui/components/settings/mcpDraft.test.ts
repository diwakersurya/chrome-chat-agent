import { expect, it } from 'vitest'
import { bridgeCommand, emptyDraft, fromRow, portOf, toRow, validateDraft } from './mcpDraft'

it('round-trips remote and local servers through the form', () => {
  const remote = toRow({ ...emptyDraft('remote'), url: ' https://mcp.example.com/mcp ', headers: [{ key: 'Authorization', value: 'Bearer x' }, { key: ' ', value: 'dropped' }] })
  expect(remote).toMatchObject({ name: 'mcp.example.com', url: 'https://mcp.example.com/mcp', transport: 'http', headers: { Authorization: 'Bearer x' } })
  expect(toRow(fromRow(remote), remote)).toEqual(remote)

  const local = toRow({ ...emptyDraft('local'), name: 'files', command: 'npx srv ~/docs', port: 9000 })
  expect(local).toMatchObject({ url: 'http://localhost:9000/sse', transport: 'sse', command: 'npx srv ~/docs' })
  expect(fromRow(local).port).toBe(9000)
})

it('validates and parses ports safely', () => {
  expect(validateDraft({ ...emptyDraft('remote'), url: 'nope' })).toMatch(/full URL/)
  expect(validateDraft({ ...emptyDraft('remote'), url: 'ftp://x/y' })).toMatch(/http/)
  expect(validateDraft({ ...emptyDraft('local'), command: '' })).toMatch(/command/)
  expect(validateDraft({ ...emptyDraft('local'), command: 'x', port: 80 })).toMatch(/port/)
  expect(portOf('not a url')).toBe(8931)
  expect(portOf('http://localhost/sse')).toBe(8931)
})

it('limits the bridge to the app origin', () => {
  expect(bridgeCommand('npx srv "a b"', 8931, 'chrome-extension://abc')).toBe(
    'npx -y supergateway --stdio "npx srv \\"a b\\"" --port 8931 --cors "chrome-extension://abc"',
  )
})
