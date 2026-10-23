import { defineConfig } from 'vite';

// The site is served from https://cig13zs.github.io/quiet-phone/
export default defineConfig({
  base: '/quiet-phone/',
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
