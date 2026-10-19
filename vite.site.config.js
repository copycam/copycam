import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public website, copycam.app: the landing page only, plus the files that
// belong at the site root (site/public). The phone app (mobile.html) is served
// by the companion on each user's own PC and has no place on the public site.
export default defineConfig({
  plugins: [react()],
  publicDir: 'site/public',
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html') } },
  },
});
