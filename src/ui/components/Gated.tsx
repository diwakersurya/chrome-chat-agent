import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, type ReactElement } from 'react'
import { featureState, type FeatureEnv, type FeatureId } from '../../core/features'
import { Tip } from './Tip'

export const FeatureEnvContext = createContext<FeatureEnv>({ target: 'web' })

export function useFeature(id: FeatureId) {
  return featureState(id, useContext(FeatureEnvContext))
}

interface Props {
  feature: FeatureId
  children: ReactElement<Record<string, unknown>>
  /** extra condition from the call site (e.g. nothing to act on yet) with its own reason */
  unless?: { when: boolean; reason: string }
  /** anchor the tooltip to the child's end edge (for controls near the right side) */
  align?: 'start' | 'end'
}

/**
 * Renders the child as-is when the feature is available. Otherwise keeps it
 * visible but disabled, and explains why on hover, focus or tap.
 */
export function Gated({ feature, children, unless, align = 'start' }: Props) {
  const state = useFeature(feature)
  const reason = !state.available ? state.reason : unless?.when ? unless.reason : undefined
  if (!reason) return children
  return (
    <Tip
      text={reason}
      align={align}
      xstyle={styles.dim}
      childProps={{
        'aria-disabled': true,
        disabled: undefined,
        // keep it focusable/clickable so the reason can be read, but do nothing
        onClick: (e: Event) => e.preventDefault(),
        onChange: () => {},
      }}
    >
      {children}
    </Tip>
  )
}

const styles = stylex.create({
  dim: { opacity: 0.45, cursor: 'not-allowed' },
})
