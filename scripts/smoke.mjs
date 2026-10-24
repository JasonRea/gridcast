// Browser smoke test: loads the home page and the demo replay, collects console errors and
// screenshots. Usage: node scripts/smoke.mjs [baseUrl] [outDir] [seconds]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8787';
const out = process.argv[3] ?? 'smoke-out';
const seconds = Number(process.argv[4] ?? 25);
const demo = process.env.DEMO_GAME_ID ?? '401873002';
mkdirSync(out, { recursive: true });

// Hosts the sandbox may block (fonts); their load failures are not app errors.
const IGNORE = [/fonts\.(googleapis|gstatic)\.com/, /ERR_TUNNEL_CONNECTION_FAILED/, /net::ERR_/];

const browser = await chromium.launch();
const errors = [];
async function visit(path, name, viewport, wait) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()) || r.test(m.location().url ?? ''))) {
      errors.push(`${name}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  for (let t = 0; t < wait; t += 5) {
    await page.waitForTimeout(Math.min(5, wait - t) * 1000);
    await page.screenshot({ path: `${out}/${name}-${String(t + 5).padStart(3, '0')}s.png` });
  }
  await page.close();
}

await visit('/', 'home', { width: 1440, height: 900 }, 5);
await visit(`/game/${demo}`, 'game', { width: 1440, height: 900 }, seconds);
await visit(`/game/${demo}`, 'phone', { width: 390, height: 844 }, 10);
await browser.close();
if (errors.length) {
  console.error(`Console errors:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('No console errors.');
