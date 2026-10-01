import * as stylex from '@stylexjs/stylex'
import { useContext } from 'react'
import { FEATURES, featureState, type FeatureDef } from '../../core/features'
import { color, font, radius, space } from '../tokens.stylex'
import { FeatureEnvContext } from './Gated'
import { Icon } from './Icon'

const where = (f: FeatureDef) =>
  f.platforms.web && f.platforms.ext ? 'Web app and extension' : f.platforms.ext ? 'Extension only' : 'Web app only'

/** Every feature, where it works, and its limits — generated from core/features.ts. */
export function CapabilitiesView() {
  const env = useContext(FeatureEnvContext)
  const here = env.target === 'ext' ? 'Chrome extension' : 'web app'
  return (
    <div {...stylex.props(styles.wrap)}>
      <p {...stylex.props(styles.intro)}>
        You’re using the <strong>{here}</strong>. Everything runs on this device. Features that can’t work here stay
        visible but disabled; hover, focus or tap them to see why.
      </p>
      <ul {...stylex.props(styles.list)}>
        {FEATURES.map((f) => {
          const s = featureState(f.id, env)
          return (
            <li key={f.id} {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.head)}>
                <span {...stylex.props(styles.label)}>{f.label}</span>
                {s.available ? (
                  <span {...stylex.props(styles.on)}>
                    <Icon name="check" /> Available here
                  </span>
                ) : (
                  <span {...stylex.props(styles.offTag)}>Not here</span>
                )}
              </div>
              {!s.available && <p {...stylex.props(styles.reason)}>{s.reason}</p>}
              <p {...stylex.props(styles.meta)}>Works in: {where(f)}</p>
              {f.limitation && <p {...stylex.props(styles.limit)}>{f.limitation}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const styles = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' },
  intro: { margin: 0, lineHeight: 1.5, color: color.ink },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.sm },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    fontFamily: font.ui,
  },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  label: { fontSize: font.sm, fontWeight: 600, color: color.ink },
  on: { display: 'inline-flex', alignItems: 'center', gap: space.xs, fontSize: font.xs, color: color.signal, whiteSpace: 'nowrap' },
  offTag: { fontSize: font.xs, color: color.warn, whiteSpace: 'nowrap' },
  reason: { margin: 0, fontSize: font.xs, color: color.warn, lineHeight: 1.45 },
  meta: { margin: 0, fontSize: font.xs, color: color.muted },
  limit: { margin: 0, fontSize: font.xs, color: color.muted, lineHeight: 1.45 },
})
