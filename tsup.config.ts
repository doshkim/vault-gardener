import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'bin/vault-gardener': 'bin/vault-gardener.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'src/index': 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    splitting: false,
  },
]);
