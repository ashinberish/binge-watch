import { defineConfig } from 'wxt'

import { SUPPORTED_HOSTS } from './src/adapters/hosts'

// The manifest is generated from entrypoints/ plus this file (Manifest V3).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Nightreel',
    description: 'Continue watching, next-episode countdowns and binge streaks.',
    // Least privilege: no <all_urls>, only the players we have adapters for.
    permissions: ['storage', 'alarms', 'sidePanel', 'identity'],
    host_permissions: [...SUPPORTED_HOSTS],
    action: { default_title: 'Nightreel' },
  },
})
