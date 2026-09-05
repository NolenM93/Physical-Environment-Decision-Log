'use client';

/**
 * Writes the worked examples into IndexedDB, once.
 *
 * The content itself lives in `demo.ts` / `demo-harbor.ts` so it can be
 * evaluated without a browser.
 */

import { DEMO_PROJECT_ID, buildDemoContent } from './demo';
import { HARBOR_COCKTAIL_ID, HARBOR_PROJECT_ID, buildHarborContent } from './demo-harbor';
import { db } from './index';

export { DEMO_PROJECT_ID, HARBOR_PROJECT_ID };

async function writeHousehold(now: number) {
  const content = buildDemoContent(now);
  const d = db();
  await d.transaction(
    'rw',
    [d.projects, d.rooms, d.items, d.features, d.layouts, d.decisions],
    async () => {
      await d.projects.put(content.project);
      await d.rooms.put(content.room);
      await d.items.bulkPut(content.items);
      await d.features.bulkPut(content.features);
      await d.layouts.bulkPut(content.layouts);
      await d.decisions.bulkPut(content.decisions);
    },
  );
}

async function writeHarbor(now: number) {
  const content = buildHarborContent(now);
  const d = db();
  await d.transaction(
    'rw',
    [d.projects, d.rooms, d.items, d.features, d.layouts, d.decisions, d.events],
    async () => {
      await d.projects.put(content.project);
      await d.rooms.put(content.room);
      await d.items.bulkPut(content.items);
      await d.features.bulkPut(content.features);
      await d.layouts.bulkPut(content.layouts);
      await d.decisions.bulkPut(content.decisions);
      await d.events.bulkPut(content.events);
    },
  );
}

export async function seedDemoProject(): Promise<string> {
  const d = db();
  const existing = await d.projects.get(DEMO_PROJECT_ID);
  if (existing) return DEMO_PROJECT_ID;
  await writeHousehold(Date.now());
  return DEMO_PROJECT_ID;
}

export async function seedHarborProject(): Promise<string> {
  const d = db();
  const existing = await d.projects.get(HARBOR_PROJECT_ID);
  if (existing) {
    const reception = await d.layouts.get(HARBOR_COCKTAIL_ID);
    if (reception && reception.setupKind !== 'reception') {
      await d.layouts.update(HARBOR_COCKTAIL_ID, {
        name: 'Reception — lounge',
        setupKind: 'reception',
      });
    }
    return HARBOR_PROJECT_ID;
  }
  await writeHarbor(Date.now());
  return HARBOR_PROJECT_ID;
}
