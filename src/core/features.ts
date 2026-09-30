import type { Capabilities } from './ai/capabilities'
import { usable } from './ai/capabilities'

// Every platform- or capability-dependent feature is declared once here.
// The UI never hides a feature: it disables it and shows `reason`, and the
// "What works here" page lists every row with its limitation upfront.

export type Target = 'web' | 'ext'

export interface FeatureEnv {
  target: Target
  caps?: Capabilities
  /** set by the extension when the active tab exposes WebMCP tools */
  pageToolCount?: number
}

export interface FeatureDef {
  id: FeatureId
  label: string
  /** which builds can have this feature at all */
  platforms: Record<Target, boolean>
  /** shown upfront on the "What works here" page, whether available or not */
  limitation?: string
  /** why the current build can't have it */
  platformReason?: string
  /** a runtime reason (missing API, model state…) or undefined when usable */
  runtime?: (env: FeatureEnv) => string | undefined
}

export type FeatureId =
  | 'chat'
  | 'image-input'
  | 'audio-input'
  | 'page-context'
  | 'sampling'
  | 'tasks'
  | 'agent-tools'
  | 'skills'
  | 'mcp-remote'
  | 'mcp-local'
  | 'webmcp'

const EXT_ONLY = 'Available in the Chrome extension, which can read the tab you’re viewing. Web pages can’t.'

export const FEATURES: FeatureDef[] = [
  {
    id: 'chat',
    label: 'Chat with the on-device model',
    platforms: { web: true, ext: true },
    limitation: 'Needs Chrome’s built-in model (Gemini Nano or Gemma 4). Web needs Chrome 148+, the extension 138+.',
    runtime: (e) => (e.caps && !usable(e.caps.prompt) ? 'Chrome’s built-in model isn’t available on this device.' : undefined),
  },
  {
    id: 'image-input',
    label: 'Attach images',
    platforms: { web: true, ext: true },
    limitation: 'Depends on the on-device model supporting image input.',
    runtime: (e) => (e.caps && !e.caps.image ? 'The on-device model on this device doesn’t accept images.' : undefined),
  },
  {
    id: 'audio-input',
    label: 'Voice messages',
    platforms: { web: true, ext: true },
    limitation: 'Depends on the on-device model supporting audio input, and microphone permission.',
    runtime: (e) => (e.caps && !e.caps.audio ? 'The on-device model on this device doesn’t accept audio.' : undefined),
  },
  {
    id: 'page-context',
    label: 'Use the current tab',
    platforms: { web: false, ext: true },
    platformReason: EXT_ONLY,
    limitation: 'Reads only when you ask. Chrome’s own pages (chrome://) can’t be read.',
  },
  {
    id: 'sampling',
    label: 'Temperature and top-K',
    platforms: { web: false, ext: true },
    platformReason: 'Chrome only lets extensions change sampling. Web pages use the model’s defaults.',
    limitation: 'Not available with Gemma 4 on Chrome 154+, which needs its most predictable sampling mode.',
    runtime: (e) =>
      e.caps?.deterministicOnly
        ? 'Chrome runs this model with speculative decoding, which fixes the sampling mode.'
        : undefined,
  },
  {
    id: 'tasks',
    label: 'Summarize, translate, rewrite, proofread',
    platforms: { web: true, ext: true },
    limitation: 'Uses Chrome’s task APIs when they work, otherwise the chat model.',
    runtime: (e) => (e.caps && !usable(e.caps.prompt) ? 'Needs the on-device model.' : undefined),
  },
  {
    id: 'agent-tools',
    label: 'Agent tools',
    platforms: { web: true, ext: true },
    limitation: 'The small on-device model picks tools less reliably than large cloud models. Fewer active tools work better.',
    runtime: (e) => (e.caps && !usable(e.caps.prompt) ? 'Needs the on-device model.' : undefined),
  },
  {
    id: 'skills',
    label: 'Skills (SKILL.md files)',
    platforms: { web: true, ext: true },
    limitation: 'Skills are instructions only. Scripts bundled in a skill don’t run. Each skill you use takes model memory.',
  },
  {
    id: 'mcp-remote',
    label: 'Remote MCP servers',
    platforms: { web: true, ext: true },
    limitation:
      'Web: the server must allow browser requests (CORS). The extension can reach any server. Static auth headers only; OAuth sign-in isn’t supported yet.',
  },
  {
    id: 'mcp-local',
    label: 'Local MCP servers',
    platforms: { web: true, ext: true },
    limitation:
      'Browsers can’t start programs, so a bridge command must be running on this machine. The app gives you the command. Web: Chrome asks once for local network access.',
  },
  {
    id: 'webmcp',
    label: 'Tools from the current page (WebMCP)',
    platforms: { web: false, ext: true },
    platformReason: EXT_ONLY,
    limitation: 'Only works on sites that expose WebMCP tools.',
    runtime: (e) => (e.pageToolCount === 0 ? 'This page doesn’t expose any WebMCP tools.' : undefined),
  },
]

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]))

export interface FeatureState {
  available: boolean
  reason?: string
}

export function featureState(id: FeatureId, env: FeatureEnv): FeatureState {
  const f = BY_ID.get(id)!
  if (!f.platforms[env.target]) return { available: false, reason: f.platformReason ?? 'Not available in this version.' }
  const reason = f.runtime?.(env)
  return reason ? { available: false, reason } : { available: true }
}
