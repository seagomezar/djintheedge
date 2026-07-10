import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app from the /djintheedge/ project subpath.
  base: '/djintheedge/',
  build: {
    rollupOptions: {
      // The on-device LLM's MediaPipe runtime is an optional peer dependency
      // that may not be installed. It is imported dynamically and expected to
      // fail gracefully (the app then uses the rule-based parser fallback), so
      // Rollup must treat it as external instead of failing the build.
      external: ['@mediapipe/tasks-genai'],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    // Vitest (unit tests) collects only *.test.js files. Playwright end-to-end
    // specs live in tests/e2e/*.spec.js and are intentionally excluded here so
    // `npm test` never tries to run browser E2E tests through vitest.
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
  },
});
