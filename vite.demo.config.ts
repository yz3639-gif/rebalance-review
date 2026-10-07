import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** Project Pages is a static sample-only build. The local Worker build is unchanged. */
export default defineConfig({
  base: '/rebalance-review/',
  publicDir: false,
  plugins: [react()],
  resolve: { alias: [{ find: /^fflate$/, replacement: fileURLToPath(new URL('./src/pdf/fflate.ts', import.meta.url)) }] },
  build: {
    outDir: 'dist-demo', emptyOutDir: true, target: 'es2022',
    rolldownOptions: { input: fileURLToPath(new URL('./demo/index.html', import.meta.url)) },
  },
  worker: { format: 'es' },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
});
