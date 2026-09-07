import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  treeshake: true,
  clean: true,
  sourcemap: false,
  minify: false,
  dts: false,
  tsconfig: './tsconfig.json',
  banner: { js: '#!/usr/bin/env node' },
});
