import * as esbuild from 'esbuild'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [],
  minify: true,
  sourcemap: false,
})

console.log(`✅ CLI built: dist/cli.js (monito v${pkg.version})`)
