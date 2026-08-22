/**
 * Runs the constraint engine over the worked example.
 *
 * The demo room is the first thing anyone sees, so it has to be a *credible*
 * starting point: imperfect in interesting ways, but not a wall of blockers.
 * This prints what the engine makes of each arrangement and fails if the
 * baseline has anything blocking in it.
 */

import { evaluateLayout } from '../src/lib/constraints/evaluate';
import { buildMovePlan } from '../src/lib/constraints/moveplan';
import { buildDemoContent } from '../src/lib/db/demo';
import { localClockToInstant } from '../src/lib/constraints/solar';
import type { InventoryItem } from '../src/lib/domain/types';

const content = buildDemoContent(Date.UTC(2026, 7, 22));
const inventory = new Map<string, InventoryItem>(content.items.map((i) => [i.id, i]));

const at = (hour: number) =>
  localClockToInstant('2026-08-22', hour, content.project.utcOffsetMinutes);

let blockersInBaseline = 0;

for (const layout of content.layouts) {
  const evaluation = evaluateLayout({
    room: content.room,
    features: content.features,
    layout,
    inventory,
    latitude: content.project.latitude,
    longitude: content.project.longitude,
    date: at(15.5),
  });

  const counts = {
    blocker: evaluation.findings.filter((f) => f.severity === 'blocker').length,
    warning: evaluation.findings.filter((f) => f.severity === 'warning').length,
    note: evaluation.findings.filter((f) => f.severity === 'note').length,
  };
  if (layout.isCurrent) blockersInBaseline = counts.blocker;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${layout.name}  ·  score ${evaluation.metrics.score}`);
  console.log(
    `  ${counts.blocker} blocking, ${counts.warning} warnings, ${counts.note} notes`,
  );
  for (const r of evaluation.readouts) {
    console.log(`  ${r.label.padEnd(18)} ${r.value.padEnd(10)} (${r.tone})`);
  }
  for (const f of evaluation.findings) {
    console.log(`  [${f.severity.padEnd(7)}] ${f.title}`);
  }

  // Sun through the day, to confirm the daylight model is actually producing
  // patches at the hours the decision log talks about.
  const lit = [9, 12, 15, 18].map((h) => {
    const e = evaluateLayout({
      room: content.room,
      features: content.features,
      layout,
      inventory,
      latitude: content.project.latitude,
      longitude: content.project.longitude,
      date: at(h),
    });
    return `${h}:00 ${(e.metrics.daylightCoverage * 100).toFixed(0)}%`;
  });
  console.log(`  sunlit floor   ${lit.join('   ')}`);
}

const [baseline, , conversation] = content.layouts;
const plan = buildMovePlan({
  room: content.room,
  features: content.features,
  from: baseline,
  to: conversation,
  inventory,
});
console.log(`\n${'='.repeat(72)}`);
console.log(
  `Move plan ${baseline.name} -> ${conversation.name}: ${plan.steps.length} steps, ` +
    `${plan.totalMinutes} min, ${plan.peopleNeeded} people, ${plan.totalDistanceM.toFixed(1)} m`,
);
for (const step of plan.steps) {
  console.log(`  ${String(step.order).padStart(2)}. ${step.instruction}`);
}
for (const warning of plan.warnings) {
  console.log(`  ! ${warning}`);
}

if (blockersInBaseline > 0) {
  console.error(`\nFAIL: the baseline arrangement has ${blockersInBaseline} blocking findings.`);
  process.exit(1);
}
console.log('\nOK: baseline is clear of blockers.');
