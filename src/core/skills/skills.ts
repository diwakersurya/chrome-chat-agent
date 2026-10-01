// Agent Skills format: a SKILL.md with `name` and `description` frontmatter
// followed by the instructions. Only the fields we use are parsed.

export interface ParsedSkill {
  name: string
  description: string
  body: string
}

export class SkillParseError extends Error {}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Minimal YAML subset: `key: value`, quoted values, and `>` / `|` block scalars. */
function parseFrontmatter(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!)
    if (!m) continue
    const key = m[1]!
    let value = m[2]!.trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1] === '')) block.push(lines[++i]!.trim())
      value = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function parseSkill(text: string, fallbackName = ''): ParsedSkill {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new SkillParseError('Missing frontmatter. A skill starts with --- name: … description: … ---')
  const fm = parseFrontmatter(m[1]!)
  const name = slug(fm.name || fallbackName)
  if (!name) throw new SkillParseError('The frontmatter needs a “name”.')
  if (!fm.description) throw new SkillParseError(`Skill “${name}” needs a “description” so the model knows when to use it.`)
  const body = m[2]!.trim()
  if (!body) throw new SkillParseError(`Skill “${name}” has no instructions after the frontmatter.`)
  return { name, description: fm.description, body }
}

export function serializeSkill(s: ParsedSkill) {
  const desc = s.description.includes('\n') || s.description.includes(': ') ? JSON.stringify(s.description) : s.description
  return `---\nname: ${s.name}\ndescription: ${desc}\n---\n\n${s.body}\n`
}

export const SKILL_TEMPLATE = serializeSkill({
  name: 'my-skill',
  description: 'What this skill does and when to use it.',
  body: '# My skill\n\nStep-by-step instructions for the model.',
})

// ---------- in messages ----------

const esc = (s: string) => s.replace(/"/g, '&quot;')

/** Skills travel as a text part so they survive persistence; the UI renders a chip. */
export function formatSkillPart(s: Pick<ParsedSkill, 'name' | 'body'>) {
  return `<skill name="${esc(s.name)}">\nFollow these instructions for this request:\n\n${s.body}\n</skill>`
}

export function parseSkillPart(text: string) {
  const m = /^<skill name="([^"]*)">\n[\s\S]*\n<\/skill>$/.exec(text)
  return m ? { name: m[1]!.replace(/&quot;/g, '"') } : undefined
}

// ---------- suggestions ----------

const STOP = new Set(
  'the and for with that this from your into when what which about have will would should could there their them then than been were also just only some more most such very can use using used how does make'.split(
    ' ',
  ),
)
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [])

/** Best skill for a draft by keyword overlap with its name and description; undefined below the threshold. */
export function suggestSkill<T extends Pick<ParsedSkill, 'name' | 'description'>>(draft: string, skills: T[]): T | undefined {
  const d = words(draft)
  if (d.size < 2) return undefined
  let best: T | undefined
  let bestScore = 0
  for (const s of skills) {
    const w = words(`${s.name.replace(/-/g, ' ')} ${s.description}`)
    let score = 0
    for (const x of d) if (w.has(x)) score++
    if (score > bestScore) (best = s), (bestScore = score)
  }
  return bestScore >= 2 ? best : undefined
}
