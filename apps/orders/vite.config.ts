import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // hmr off: the shell imports the dev module cross-origin without the React Fast Refresh preamble.
  server: { port: 5174, strictPort: true, hmr: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    cssCodeSplit: false,
    lib: {
      entry: 'src/orders-app.ts',
      formats: ['es'],
      fileName: () => 'orders-app.js',
    },
  },
});
