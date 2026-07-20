import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // marketing/demo page (hosted anywhere)
        main: resolve(import.meta.dirname, 'index.html'),
        // the real phone app, served over LAN by server/index.js
        mobile: resolve(import.meta.dirname, 'mobile.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
