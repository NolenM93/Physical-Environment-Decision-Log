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
const BASE = (process.env.SMOKE_BASE ?? `http://localhost:${PORT}`).replace(/\/$/, '');
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
  if (process.env.SMOKE_BASE) {
    throw new Error(`SMOKE_BASE ${BASE} is not answering`);
  }

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

async function assertCanvas(page, label) {
  const stats = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')].map((c) => {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      let filled = 0;
      if (gl && c.width > 0 && c.height > 0) {
        const w = 24;
        const h = 24;
        const buf = new Uint8Array(w * h * 4);
        const x = Math.max(0, Math.floor(c.width / 2 - w / 2));
        const y = Math.max(0, Math.floor(c.height / 2 - h / 2));
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (let i = 0; i < buf.length; i += 4) {
          if (buf[i] + buf[i + 1] + buf[i + 2] > 40) filled++;
        }
      } else {
        const ctx = c.getContext('2d');
        if (ctx && c.width > 0 && c.height > 0) {
          const data = ctx.getImageData(0, 0, Math.min(c.width, 48), Math.min(c.height, 48)).data;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] > 40) filled++;
          }
        }
      }
      return { w: c.width, h: c.height, filled, webgl: Boolean(gl) };
    });
  });
  if (!stats.some((s) => s.w > 20 && s.h > 20 && s.filled > 8)) {
    problems.push(`${label} canvas looks blank: ${JSON.stringify(stats)}`);
  }
}

const server = await ensureServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  const url = r.url();
  if (r.status() >= 400 && !/favicon|cdn\.jsdelivr|polyhaven/i.test(url)) {
    problems.push(`http ${r.status()} ${url}`);
  }
});

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  captured ${name}`);
}

console.log('landing');
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-landing');

console.log('seeding living room');
await page.getByRole('button', { name: /try a living room/i }).first().click();
await page.waitForURL(/\/studio/, { timeout: 60_000 });
await page.waitForTimeout(4000);
await page.locator('button[title="Walk the room"]').first().click();
await page.waitForTimeout(2500);
await shot('02-living-3d');
await assertCanvas(page, 'living-3d');

const roomLabel = await page.locator('body').innerText();
if (!/add furniture|walkway|as it stands|conversation/i.test(roomLabel)) {
  problems.push('studio rendered without any recognisable room text');
}
if (!/sunlit floor|plugged in|walkable floor|narrowest route/i.test(roomLabel)) {
  problems.push('living room status card is missing layout-check readouts');
}

console.log('floor plan');
await page.locator('button[title="Scaled floor plan"]').first().click();
await page.waitForTimeout(1000);
await shot('03-living-plan');
await assertCanvas(page, 'living-plan');

console.log('decision log');
await page.getByRole('button', { name: /decision log/i }).first().click();
await page.waitForTimeout(700);
const logText = await page.locator('body').innerText();
if (!/baseline|record a decision|tried facing/i.test(logText)) {
  problems.push('decision log did not show sample entries');
}
await shot('04-living-log');

console.log('layout checks');
await page.getByRole('button', { name: /to fix|layout checks/i }).first().click();
await page.waitForTimeout(700);
const checkText = await page.locator('body').innerText();
if (!/walkable|outlet|door|window|aisle|sunlit|plugged/i.test(checkText)) {
  problems.push('layout checks panel had no recognisable results');
}
await shot('05-living-checks');

console.log('conversation + move plan');
await page.getByRole('button', { name: /conversation pit/i }).first().click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /what to move/i }).first().click();
await page.waitForTimeout(900);
const moveText = await page.locator('body').innerText();
if (!/move the|park|put back|bring|shift the|people/i.test(moveText)) {
  problems.push('move plan did not show steps');
}
await shot('06-living-move');

console.log('add furniture');
await page.getByRole('button', { name: /add furniture/i }).first().click();
await page.waitForTimeout(600);
await shot('07-living-add');

console.log('back to 3d');
await page.locator('button[title="Walk the room"]').first().click();
await page.waitForTimeout(2000);
await shot('08-living-3d-again');
await assertCanvas(page, 'living-3d-again');

console.log('wedding');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /try a sample wedding/i }).first().click();
await page.waitForURL(/\/studio/, { timeout: 60_000 });
await page.waitForTimeout(4000);
await page.locator('button[title="Walk the room"]').first().click();
await page.waitForTimeout(2500);
await shot('09-wedding-3d');
await assertCanvas(page, 'wedding-3d');

const weddingLabel = await page.locator('body').innerText();
if (!/dinner|reception|ceremony|seats|walkway/i.test(weddingLabel)) {
  problems.push('wedding studio rendered without setup tabs');
}

console.log('wedding dinner + checks');
await page.getByRole('button', { name: /^dinner$/i }).first().click();
await page.waitForTimeout(800);
const fix = page.getByRole('button', { name: /to fix|layout checks/i }).first();
if (await fix.count()) {
  await fix.click();
  await page.waitForTimeout(700);
}
await shot('10-wedding-dinner');

console.log('wedding move plan');
await page.getByRole('button', { name: /what to move/i }).first().click();
await page.waitForTimeout(800);
await shot('11-wedding-move');

console.log('wedding decision log');
await page.getByRole('button', { name: /decision log/i }).first().click();
await page.waitForTimeout(700);
const weddingLog = await page.locator('body').innerText();
if (!/issued to ops|longs lose|record a decision/i.test(weddingLog)) {
  problems.push('wedding decision log did not show sample entries');
}
await shot('12-wedding-log');

console.log('capture wizard');
await page.goto(`${BASE}/capture/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('13-capture');

console.log('mobile living room');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /try a living room/i }).first().click();
await page.waitForURL(/\/studio/, { timeout: 60_000 });
await page.waitForTimeout(3500);
await shot('14-mobile-living');
await assertCanvas(page, 'mobile-living');
await page.getByRole('button', { name: /decision log/i }).first().click();
await page.waitForTimeout(700);
await shot('15-mobile-log');

await browser.close();
server?.kill();

if (problems.length) {
  console.error('\nPROBLEMS');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log('\nclean');
