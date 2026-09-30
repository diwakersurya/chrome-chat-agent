import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { db, useDbQuery } from '../../core/db/client'
import type { SkillRow } from '../../core/db/repo'
import { parseSkill, serializeSkill, SKILL_TEMPLATE, SkillParseError } from '../../core/skills/skills'
import { FEATURES } from '../../core/features'
import { color, font, radius, size, space } from '../tokens.stylex'
import { Button } from './Button'
import { Icon } from './Icon'

const LIMIT = FEATURES.find((f) => f.id === 'skills')!.limitation

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Folder name of a SKILL.md inside a picked directory: "skills/code-review/SKILL.md" → "code-review". */
const folderOf = (f: File) => {
  const parts = (f.webkitRelativePath || f.name).split('/')
  return parts.length > 1 ? parts.at(-2)! : f.name.replace(/\.md$/i, '')
}

export function SkillsSettings() {
  const { data: skills = [] } = useDbQuery(() => db.listSkills(), [], ['skills'])
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
        const s = parseSkill(await f.text(), folderOf(f))
        await db.saveSkill({ id: crypto.randomUUID(), ...s, enabled: true, source: f.webkitRelativePath || f.name })
        ok.push(s.name)
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
      const s = parseSkill(editing.text)
      const existing = skills.find((x) => x.id === editing.id)
      if (existing) await db.updateSkill(existing.id, { ...s, enabled: existing.enabled, source: existing.source })
      else await db.saveSkill({ id: crypto.randomUUID(), ...s, enabled: true, source: 'manual' })
      setEditing(undefined)
      setReport(undefined)
    } catch (e) {
      setReport({ ok: [], errors: [e instanceof SkillParseError ? e.message : String(e)] })
    }
  }

  const toggle = (s: SkillRow) => db.updateSkill(s.id, { ...s, enabled: !s.enabled })

  return (
    <div {...stylex.props(styles.wrap)}>
      <p {...stylex.props(styles.hint)}>
        Skills are reusable instructions in the <code>SKILL.md</code> format used by Claude, Codex and other agents. Use
        one by typing <kbd>/</kbd> in the message box.
      </p>
      <p {...stylex.props(styles.limit)}>
        <Icon name="info" /> {LIMIT}
      </p>

      <div
        {...stylex.props(styles.buttons)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void importFiles(e.dataTransfer.files)
        }}
      >
        <label {...stylex.props(styles.fileBtn)}>
          <Icon name="upload" /> Import files
          <input type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => e.target.files && importFiles(e.target.files)} />
        </label>
        <label {...stylex.props(styles.fileBtn)}>
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
      <p {...stylex.props(styles.hint)}>You can also drop .md files here. Importing a skill with an existing name updates it.</p>

      {report && (
        <div role="status" {...stylex.props(styles.report)}>
          {report.ok.length > 0 && <p {...stylex.props(styles.ok)}>Imported {report.ok.map((n) => `/${n}`).join(', ')}.</p>}
          {report.errors.map((e) => (
            <p key={e} {...stylex.props(styles.err)}>
              <Icon name="alert" /> {e}
            </p>
          ))}
        </div>
      )}

      {editing && (
        <div {...stylex.props(styles.editor)}>
          <textarea
            aria-label="Skill file"
            value={editing.text}
            rows={12}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            {...stylex.props(styles.textarea)}
          />
          <div {...stylex.props(styles.buttons)}>
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
        <p {...stylex.props(styles.hint)}>No skills yet.</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {skills.map((s) => (
            <li key={s.id} {...stylex.props(styles.item)}>
              <label {...stylex.props(styles.itemMain)}>
                <input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} aria-label={`Enable ${s.name}`} />
                <span {...stylex.props(styles.itemText)}>
                  <span {...stylex.props(styles.name)}>/{s.name}</span>
                  <span {...stylex.props(styles.hint)}>{s.description}</span>
                  <span {...stylex.props(styles.meta)}>About {Math.ceil(s.body.length / 4).toLocaleString()} tokens when used</span>
                </span>
              </label>
              <div {...stylex.props(styles.itemActions)}>
                <Button icon="edit" label="Edit" onClick={() => setEditing({ id: s.id, text: serializeSkill(s) })} />
                <Button icon="download" label="Export SKILL.md" onClick={() => download(`${s.name}.SKILL.md`, serializeSkill(s))} />
                <Button icon="trash" label="Delete" onClick={() => db.deleteSkill(s.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const styles = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' },
  hint: { margin: 0, color: color.muted, lineHeight: 1.45 },
  limit: {
    display: 'flex',
    gap: space.sm,
    margin: 0,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.sunken,
    color: color.ink,
    lineHeight: 1.45,
  },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  fileBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    height: size.control,
    paddingInline: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: { default: color.surface, ':hover': color.sunken },
    fontWeight: 500,
    cursor: 'pointer',
  },
  report: { display: 'flex', flexDirection: 'column', gap: space.xs },
  ok: { margin: 0, color: color.signal },
  err: { display: 'flex', gap: space.xs, margin: 0, color: color.danger },
  editor: { display: 'flex', flexDirection: 'column', gap: space.sm },
  textarea: {
    width: '100%',
    resize: 'vertical',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    backgroundColor: color.bg,
    fontFamily: font.mono,
    fontSize: font.xs,
    lineHeight: 1.5,
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.sm },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
  },
  itemMain: { display: 'flex', gap: space.sm, flex: 1, minWidth: 0, cursor: 'pointer' },
  itemText: { display: 'flex', flexDirection: 'column', gap: space.xxs, minWidth: 0 },
  name: { fontWeight: 600 },
  meta: { fontSize: font.xs, color: color.muted },
  itemActions: { display: 'flex' },
})
