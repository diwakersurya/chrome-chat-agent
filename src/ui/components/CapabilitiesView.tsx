import * as stylex from '@stylexjs/stylex'
import { useContext } from 'react'
import { FEATURES, featureState } from '../../core/features'
import { color, font, radius, space } from '../tokens.stylex'
import { FeatureEnvContext } from './Gated'
import { Icon } from './Icon'

/** Every feature, where it works, and its limits — generated from core/features.ts. */
export function CapabilitiesView() {
  const env = useContext(FeatureEnvContext)
  const here = env.target === 'ext' ? 'Chrome extension' : 'web app'
  return (
    <div {...stylex.props(styles.wrap)}>
      <p {...stylex.props(styles.intro)}>
        You’re using the <strong>{here}</strong>. Everything runs on this device. Features that can’t work here stay
        visible but disabled; hover them to see why.
      </p>
      <div {...stylex.props(styles.tableWrap)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)}>Feature</th>
              <th {...stylex.props(styles.th, styles.center)}>Web</th>
              <th {...stylex.props(styles.th, styles.center)}>Extension</th>
              <th {...stylex.props(styles.th)}>Here</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => {
              const s = featureState(f.id, env)
              return (
                <tr key={f.id}>
                  <td {...stylex.props(styles.td)}>
                    <span {...stylex.props(styles.label)}>{f.label}</span>
                    <span {...stylex.props(styles.limit)}>{f.limitation}</span>
                  </td>
                  <td {...stylex.props(styles.td, styles.center)}>{f.platforms.web ? 'Yes' : '—'}</td>
                  <td {...stylex.props(styles.td, styles.center)}>{f.platforms.ext ? 'Yes' : '—'}</td>
                  <td {...stylex.props(styles.td)}>
                    {s.available ? (
                      <span {...stylex.props(styles.on)}>
                        <Icon name="check" /> Available
                      </span>
                    ) : (
                      <span {...stylex.props(styles.off)}>{s.reason}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' },
  intro: { margin: 0, lineHeight: 1.5, color: color.ink },
  tableWrap: { overflowX: 'auto', borderRadius: radius.md, borderWidth: 1, borderStyle: 'solid', borderColor: color.line },
  table: { width: '100%', borderCollapse: 'collapse', fontFamily: font.ui, fontSize: font.xs },
  th: {
    textAlign: 'start',
    paddingInline: space.sm,
    paddingBlock: space.xs,
    backgroundColor: color.sunken,
    fontWeight: 600,
    color: color.muted,
  },
  td: {
    verticalAlign: 'top',
    paddingInline: space.sm,
    paddingBlock: space.sm,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.line,
  },
  center: { textAlign: 'center' },
  label: { display: 'block', fontSize: font.sm, fontWeight: 500, color: color.ink },
  limit: { display: 'block', marginTop: space.xxs, color: color.muted, lineHeight: 1.4 },
  on: { display: 'inline-flex', alignItems: 'center', gap: space.xs, color: color.signal },
  off: { color: color.warn, lineHeight: 1.4 },
})
