import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Local Chat Agent',
  description: 'Private chat agent powered by Chrome built-in AI (Gemini Nano). Nothing leaves your device.',
  version: pkg.version,
  minimum_chrome_version: '138',
  action: { default_title: 'Open Local Chat Agent', default_icon: { 128: 'icon-128.png' } },
  icons: { 128: 'icon-128.png' },
  side_panel: { default_path: 'sidepanel.html' },
  background: { service_worker: 'src/entries/ext/background.ts', type: 'module' },
  permissions: ['sidePanel', 'activeTab', 'scripting', 'contextMenus', 'storage'],
  host_permissions: ['<all_urls>'],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
})
