import { defineConfig } from 'vite';

// Bundles the CLI and everything it uses into one file, so `npx quiet-phone` installs nothing else.
export default defineConfig({
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'dist-cli',
    target: 'node20',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'quiet-phone.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
