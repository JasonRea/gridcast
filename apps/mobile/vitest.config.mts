import { realpathSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Test-only: the GSAP parity test drives the web's real timelines. The app never loads GSAP.
const gsapDir = realpathSync(here('../web/node_modules/gsap'));

// Unit tests for the app's pure modules only (no React Native runtime): SSE parser, field
// planner, API schema handling, announcer queue, citations.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@web\/(.*)$/, replacement: `${here('../web/src')}/$1` },
      { find: /^@\/(.*)$/, replacement: `${here('./src')}/$1` },
      { find: /^gsap$/, replacement: `${gsapDir}/index.js` },
      { find: /^gsap\/(.*)$/, replacement: `${gsapDir}/$1.js` },
    ],
  },
  test: {
    name: 'mobile',
    include: ['test/**/*.test.ts'],
    server: { deps: { inline: [/gsap/] } },
  },
});
