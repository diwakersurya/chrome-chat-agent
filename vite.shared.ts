import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'
import type { UserConfig } from 'vite'

export const shared = (target: 'web' | 'ext'): UserConfig => ({
  plugins: [stylex.vite(), react()],
  define: { __TARGET__: JSON.stringify(target) },
  // sqlite-wasm ships its own wasm loader; pre-bundling breaks the wasm URL
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2023' },
})
