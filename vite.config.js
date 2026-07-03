import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app from the /djintheedge/ project subpath.
  base: '/djintheedge/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
