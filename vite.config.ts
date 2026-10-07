import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^fflate$/, replacement: fileURLToPath(new URL('./src/pdf/fflate.ts', import.meta.url)) }] },
  build: { target: 'es2022', rolldownOptions: { input: {
    main: fileURLToPath(new URL('./index.html', import.meta.url)),
    design: fileURLToPath(new URL('./design/index.html', import.meta.url)),
  } } },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/e2e/**'] },
});
