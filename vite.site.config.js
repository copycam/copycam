import fs from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist');

// What the copycam.app tab downloads to read text, so it can show honest
// progress. scripts/fetch-models.mjs puts the model in models/ first.
function readerBytes() {
  const size = (p) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  return {
    det: size(resolve(root, 'models/PP-OCRv6_small_det.ort')),
    rec: size(resolve(root, 'models/PP-OCRv6_small_rec.ort')),
    dict: size(resolve(root, 'models/ppocrv6_dict.txt')),
    wasm: size(resolve(ortDist, 'ort-wasm-simd-threaded.wasm')),
  };
}

// The public website, copycam.app:
//   /       the landing page
//   /app/   CopyCam for the computer, in a browser tab (src/web/HostApp.jsx)
//   /p/     the phone app, linked to that tab through the relay (worker/)
// plus the files that belong at the site root (site/public). The companion's
// own phone page (mobile.html) is served by each user's own computer and has
// no place here.
export default defineConfig({
  plugins: [react()],
  publicDir: 'site/public',
  resolve: {
    alias: [
      // The text reader's runtime, CPU (WebAssembly) build only. The default
      // build also carries a 26 MB WebGPU binary, bigger than a site file may be.
      { find: /^onnxruntime-web$/, replacement: resolve(ortDist, 'ort.wasm.min.mjs') },
    ],
  },
  define: { __READER_BYTES__: JSON.stringify(readerBytes()) },
  worker: { format: 'es' },
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    // the reader's model and runtime are large on purpose
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        app: resolve(root, 'app/index.html'),
        phone: resolve(root, 'p/index.html'),
        // the WebRTC lab (src/lab): hidden test pages, not linked from anywhere
        'lab-pc': resolve(root, 'app/lab/index.html'),
        'lab-phone': resolve(root, 'p/lab/index.html'),
      },
    },
  },
});
