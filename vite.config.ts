import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// On CI/prod (GitHub Pages) we never need the dev-server SSL plugin.
// Locally we enable it so WebXR (navigator.xr) works over LAN — browsers
// only expose navigator.xr in secure contexts (HTTPS or localhost).
const isCI = !!process.env.GITHUB_ACTIONS

export default defineConfig({
  plugins: [
    react(),
    ...(isCI ? [] : [basicSsl()]),
  ],
  base: isCI ? '/3DQuickViewer/' : '/',
})
