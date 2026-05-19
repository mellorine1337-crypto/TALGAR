import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  build: {
    target: ['chrome64', 'safari12', 'firefox67'],
  },
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 60', 'android >= 6'],
      modernPolyfills: true,
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
