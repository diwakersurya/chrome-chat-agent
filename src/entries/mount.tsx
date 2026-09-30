import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../ui/global.css'
import { App } from '../ui/App'
import type { Platform } from '../platform/platform'

export function mount(platform: Platform) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App platform={platform} />
    </StrictMode>,
  )
}
