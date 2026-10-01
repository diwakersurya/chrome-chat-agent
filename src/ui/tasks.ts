// Transforms offered on every message (Chrome task APIs, with a Prompt API fallback).

export type TaskId =
  | 'summarize'
  | 'key-points'
  | 'translate:en'
  | 'translate:es'
  | 'translate:fr'
  | 'translate:de'
  | 'translate:hi'
  | 'translate:ja'
  | 'rewrite:more-formal'
  | 'rewrite:more-casual'
  | 'rewrite:shorter'
  | 'proofread'

export const TASK_LABELS: Record<TaskId, string> = {
  summarize: 'Summarize',
  'key-points': 'Key points',
  'translate:en': 'Translate to English',
  'translate:es': 'Translate to Spanish',
  'translate:fr': 'Translate to French',
  'translate:de': 'Translate to German',
  'translate:hi': 'Translate to Hindi',
  'translate:ja': 'Translate to Japanese',
  'rewrite:more-formal': 'Make more formal',
  'rewrite:more-casual': 'Make more casual',
  'rewrite:shorter': 'Make shorter',
  proofread: 'Proofread',
}
