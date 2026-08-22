/**
 * Headless walk-through of the demo flow.
 *
 * The interesting failures in this app are all client-side — IndexedDB seeding,
 * WebGL, the vision worker — so a smoke test has to run a real browser.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = process.env.SMOKE_PORT ?? '3111';
const BASE = process.env.SMOKE_BASE ?? `http://localhost:${PORT}`;
const SHOTS = 'scripts/.shots';
mkdirSync(SHOTS, { recursive: true });

const problems = [];

/** Start a dev server unless one is already answering, so this runs from cold. */
async function ensureServer() {
  const alive = async () => {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      return false;
    }
  };
  if (await alive()) return null;

  console.log(`starting dev server on ${PORT}`);
  // Run Next's binary through this same node rather than npx: Windows refuses to
  // spawn a .cmd shim without a shell, and a shell brings its own problems.
  const nextBin = fileURLToPath(import.meta.resolve('next/dist/bin/next'));
  const server = spawn(process.execPath, [nextBin, 'dev', '--port', PORT], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await alive()) return server;
  }
  server.kill();
  throw new Error('dev server never came up');
}

const server = await ensureServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`  captured ${name}`);
}

console.log('landing');
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-landing');

console.log('seeding demo');
await page.getByRole('button', { name: /explore a real room/i }).first().click();
await page.waitForURL(/\/studio/, { timeout: 60_000 });
await page.waitForTimeout(4000);
await shot('02-studio-3d');

const roomLabel = await page.locator('body').innerText();
if (!/sun|clearance|blocker|warning|arrangement/i.test(roomLabel)) {
  problems.push('studio rendered without any recognisable panel text');
}

console.log('03-plan');
await page.locator('button[title="Scaled floor plan"]').first().click();
await page.waitForTimeout(1500);
await shot('03-plan');

console.log('04-compare');
await page.locator('button:has-text("Compare")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("Conversation pit")').last().click();
await page.waitForTimeout(2000);
await shot('04-compare');

// The move plan runs from the room as it actually is to whichever arrangement
// is open, so switch to the alternative before looking at it.
console.log('05-moveplan');
await page.locator('aside').first().locator('button:has-text("Conversation pit")').first().click();
await page.waitForTimeout(1200);
await page.locator('button:has-text("Move plan")').first().click();
await page.waitForTimeout(2500);
await shot('05-moveplan');

console.log('06-photo');
await page.locator('button[title="Photo match"]').first().click();
await page.waitForTimeout(1500);
await shot('06-photo');

console.log('capture wizard');
await page.goto(`${BASE}/capture`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('07-capture');

await browser.close();
server?.kill();

if (problems.length) {
  console.error('\nPROBLEMS');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log('\nclean');
