import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { db, useDbQuery } from '../../../core/db/client'
import type { SkillRow } from '../../../core/db/repo'
import { FEATURES } from '../../../core/features'
import { parseSkill, serializeSkill, SKILL_TEMPLATE, SkillParseError } from '../../../core/skills/skills'
import { download } from '../../download'
import { useToast } from '../../toast'
import { space } from '../../tokens.stylex'
import { Button } from '../Button'
import { Icon } from '../Icon'
import { s } from './styles'

const LIMIT = FEATURES.find((f) => f.id === 'skills')!.limitation

/** Folder name of a SKILL.md inside a picked directory: "skills/code-review/SKILL.md" → "code-review". */
const folderOf = (f: File) => {
  const parts = (f.webkitRelativePath || f.name).split('/')
  return parts.length > 1 ? parts.at(-2)! : f.name.replace(/\.md$/i, '')
}

/** Settings → Skills: import, write, edit, toggle, export and delete SKILL.md files. */
export function SkillsSettings() {
  const { data } = useDbQuery(() => db.listSkills(), [], ['skills'])
  const skills = data ?? []
  const toast = useToast()
  const [editing, setEditing] = useState<{ id?: string; text: string }>()
  const [report, setReport] = useState<{ ok: string[]; errors: string[] }>()

  const importFiles = async (files: FileList | File[]) => {
    const ok: string[] = []
    const errors: string[] = []
    for (const f of [...files]) {
      if (!/\.md$/i.test(f.name)) continue
      // inside a folder only SKILL.md files are skills; loose .md files are taken as-is
      if (f.webkitRelativePath && !/^skill\.md$/i.test(f.name)) continue
      try {
        const parsed = parseSkill(await f.text(), folderOf(f))
        await db.saveSkill({ id: crypto.randomUUID(), ...parsed, enabled: true, source: f.webkitRelativePath || f.name })
        ok.push(parsed.name)
      } catch (e) {
        errors.push(`${f.webkitRelativePath || f.name}: ${e instanceof SkillParseError ? e.message : String(e)}`)
      }
    }
    if (!ok.length && !errors.length) errors.push('No SKILL.md or .md files were found.')
    setReport({ ok, errors })
  }

  const saveEdit = async () => {
    if (!editing) return
    try {
      const parsed = parseSkill(editing.text)
      const existing = skills.find((x) => x.id === editing.id)
      if (existing) await db.updateSkill(existing.id, { ...parsed, enabled: existing.enabled, source: existing.source })
      else await db.saveSkill({ id: crypto.randomUUID(), ...parsed, enabled: true, source: 'manual' })
      setEditing(undefined)
      setReport(undefined)
    } catch (e) {
      setReport({ ok: [], errors: [e instanceof SkillParseError ? e.message : String(e)] })
    }
  }

  const remove = async (skill: SkillRow) => {
    await db.deleteSkill(skill.id)
    toast.show({ text: `Deleted /${skill.name}`, action: { label: 'Undo', run: () => void db.saveSkill(skill) } })
  }

  return (
    <div {...stylex.props(s.stack)}>
      <p {...stylex.props(s.hint)}>
        Skills are reusable instructions in the <code>SKILL.md</code> format used by Claude, Codex and other agents. Use one
        by typing <kbd>/</kbd> in the message box.
      </p>
      <p {...stylex.props(s.limit)}>
        <Icon name="info" /> {LIMIT}
      </p>

      <div
        {...stylex.props(s.buttons)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void importFiles(e.dataTransfer.files)
        }}
      >
        <label {...stylex.props(s.fileBtn)}>
          <Icon name="upload" /> Import files
          <input type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => e.target.files && importFiles(e.target.files)} />
        </label>
        <label {...stylex.props(s.fileBtn)}>
          <Icon name="upload" /> Import folder
          <input
            type="file"
            hidden
            // a skills folder: every */SKILL.md inside is imported
            {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={(e) => e.target.files && importFiles(e.target.files)}
          />
        </label>
        <Button variant="quiet" icon="plus" onClick={() => setEditing({ text: SKILL_TEMPLATE })}>
          New skill
        </Button>
      </div>
      <p {...stylex.props(s.hint)}>You can also drop .md files here. Importing a skill with an existing name updates it.</p>

      {report && (
        <div role="status" {...stylex.props(styles.report)}>
          {report.ok.length > 0 && <p {...stylex.props(s.ok)}>Imported {report.ok.map((n) => `/${n}`).join(', ')}.</p>}
          {report.errors.map((e) => (
            <p key={e} {...stylex.props(s.err)}>
              <Icon name="alert" /> {e}
            </p>
          ))}
        </div>
      )}

      {editing && (
        <div {...stylex.props(s.stack)}>
          <textarea
            autoFocus
            aria-label="Skill file"
            value={editing.text}
            rows={12}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            {...stylex.props(s.textarea, s.mono)}
          />
          <div {...stylex.props(s.buttons)}>
            <Button variant="primary" onClick={saveEdit}>
              Save skill
            </Button>
            <Button variant="quiet" onClick={() => (setEditing(undefined), setReport(undefined))}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <p {...stylex.props(s.hint)}>No skills yet.</p>
      ) : (
        <ul {...stylex.props(s.list)}>
          {skills.map((skill) => (
            <li key={skill.id} {...stylex.props(s.item, styles.row)}>
              <label {...stylex.props(s.itemMain)}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={() => db.updateSkill(skill.id, { ...skill, enabled: !skill.enabled })}
                  aria-label={`Use /${skill.name}`}
                />
                <span {...stylex.props(s.itemText)}>
                  <span {...stylex.props(s.name)}>/{skill.name}</span>
                  <span {...stylex.props(s.hint)}>{skill.description}</span>
                  <span {...stylex.props(s.meta)}>About {Math.ceil(skill.body.length / 4).toLocaleString()} tokens when used</span>
                </span>
              </label>
              <div {...stylex.props(s.itemActions)}>
                <Button icon="edit" label="Edit" onClick={() => setEditing({ id: skill.id, text: serializeSkill(skill) })} />
                <Button
                  icon="download"
                  label="Export SKILL.md"
                  onClick={() => download(`${skill.name}.SKILL.md`, 'text/markdown', serializeSkill(skill))}
                />
                <Button icon="trash" label="Delete" onClick={() => remove(skill)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const styles = stylex.create({
  report: { display: 'flex', flexDirection: 'column', gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
})
