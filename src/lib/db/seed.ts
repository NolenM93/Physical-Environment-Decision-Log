'use client';

/**
 * Writes the worked example into IndexedDB, once.
 *
 * The content itself lives in `demo.ts` so it can be evaluated without a browser.
 */

import { DEMO_PROJECT_ID, buildDemoContent } from './demo';
import { db } from './index';

export { DEMO_PROJECT_ID };

export async function seedDemoProject(): Promise<string> {
  const d = db();
  const existing = await d.projects.get(DEMO_PROJECT_ID);
  if (existing) return DEMO_PROJECT_ID;

  const content = buildDemoContent(Date.now());

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

  return DEMO_PROJECT_ID;
}
