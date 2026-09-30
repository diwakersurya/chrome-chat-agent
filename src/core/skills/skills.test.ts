import { describe, expect, it } from 'vitest'
import { formatSkillPart, parseSkill, parseSkillPart, serializeSkill, suggestSkill } from './skills'

describe('parseSkill', () => {
  it('reads name, description (incl. folded blocks) and body', () => {
    const s = parseSkill(`---
name: Code Review
description: >
  Review a diff for bugs
  and risky changes.
license: MIT
---

# Steps
1. Read the diff`)
    expect(s).toEqual({
      name: 'code-review',
      description: 'Review a diff for bugs and risky changes.',
      body: '# Steps\n1. Read the diff',
    })
  })

  it('falls back to the folder name and reports what is missing', () => {
    expect(parseSkill('---\ndescription: "Does: things"\n---\nbody', 'My Folder').name).toBe('my-folder')
    expect(() => parseSkill('no frontmatter')).toThrow(/frontmatter/)
    expect(() => parseSkill('---\nname: x\n---\nbody')).toThrow(/description/)
    expect(() => parseSkill('---\nname: x\ndescription: y\n---\n')).toThrow(/instructions/)
  })

  it('round-trips through serializeSkill', () => {
    const s = { name: 'a', description: 'Uses: colons', body: 'Do it' }
    expect(parseSkill(serializeSkill(s))).toEqual(s)
  })
})

it('wraps skills for the model and recognises them in messages', () => {
  const part = formatSkillPart({ name: 'code-review', body: 'Check it' })
  expect(parseSkillPart(part)).toEqual({ name: 'code-review' })
  expect(parseSkillPart('hello')).toBeUndefined()
})

it('suggests a skill only on a clear keyword match', () => {
  const skills = [
    { name: 'code-review', description: 'Review a pull request diff for bugs' },
    { name: 'trip-planner', description: 'Plan travel itineraries with budgets' },
  ]
  expect(suggestSkill('can you review this diff for bugs please', skills)?.name).toBe('code-review')
  expect(suggestSkill('plan a travel itinerary to Lisbon', skills)?.name).toBe('trip-planner')
  expect(suggestSkill('hello there', skills)).toBeUndefined()
})
