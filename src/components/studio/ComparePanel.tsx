'use client';

import { useMemo } from 'react';
import { ArrowRight, GitCompare } from 'lucide-react';
import { Panel, cn } from '@/components/ui/primitives';
import { useLayoutEvaluation } from '@/lib/hooks/useEvaluation';
import type { Evaluation } from '@/lib/constraints/evaluate';
import { useStudio } from '@/lib/store/studio';

interface Row {
  label: string;
  a: number;
  b: number;
  format: (v: number) => string;
  /** Which direction counts as better. */
  better: 'higher' | 'lower';
  hint?: string;
}

export function ComparePanel({ evaluation }: { evaluation: Evaluation | null }) {
  const compareLayoutId = useStudio((s) => s.compareLayoutId);
  const layouts = useStudio((s) => s.layouts);
  const layoutId = useStudio((s) => s.layoutId);
  const setCompare = useStudio((s) => s.setCompare);
  const roomId = useStudio((s) => s.roomId);

  const other = useLayoutEvaluation(compareLayoutId);
  const roomLayouts = layouts.filter((l) => l.roomId === roomId && l.id !== layoutId);

  const rows: Row[] = useMemo(() => {
    if (!evaluation || !other) return [];
    const m = evaluation.metrics;
    const n = other.metrics;
    return [
      { label: 'Overall score', a: m.score, b: n.score, format: (v) => String(Math.round(v)), better: 'higher' },
      {
        label: 'Walkable floor',
        a: m.usableFloorRatio,
        b: n.usableFloorRatio,
        format: (v) => `${Math.round(v * 100)}%`,
        better: 'higher',
        hint: 'Share of the room you can cross at full walking width',
      },
      { label: 'Overlaps', a: m.collisions, b: n.collisions, format: (v) => String(v), better: 'lower' },
      {
        label: 'Access problems',
        a: m.clearanceViolations,
        b: n.clearanceViolations,
        format: (v) => String(v),
        better: 'lower',
      },
      {
        label: 'Things plugged in',
        a: m.totalOutletDemands ? m.reachableOutlets / m.totalOutletDemands : 1,
        b: n.totalOutletDemands ? n.reachableOutlets / n.totalOutletDemands : 1,
        format: (v) => `${Math.round(v * 100)}%`,
        better: 'higher',
      },
      {
        label: 'Sunlit floor',
        a: m.daylightCoverage,
        b: n.daylightCoverage,
        format: (v) => `${Math.round(v * 100)}%`,
        better: 'higher',
        hint: 'At the time currently set on the sun slider',
      },
      {
        label: 'Blocking issues',
        a: evaluation.findings.filter((f) => f.severity === 'blocker').length,
        b: other.findings.filter((f) => f.severity === 'blocker').length,
        format: (v) => String(v),
        better: 'lower',
      },
    ];
  }, [evaluation, other]);

  const onlyHere = useMemo(() => {
    if (!evaluation || !other) return [];
    const theirs = new Set(other.findings.map((f) => f.code + f.itemIds.join()));
    return evaluation.findings.filter((f) => !theirs.has(f.code + f.itemIds.join()));
  }, [evaluation, other]);

  const onlyThere = useMemo(() => {
    if (!evaluation || !other) return [];
    const mine = new Set(evaluation.findings.map((f) => f.code + f.itemIds.join()));
    return other.findings.filter((f) => !mine.has(f.code + f.itemIds.join()));
  }, [evaluation, other]);

  if (!compareLayoutId || !other) {
    return (
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <GitCompare size={12} /> Compare
          </span>
        }
        className="min-h-0"
      >
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Pick another arrangement to weigh this one against. You get a side-by-side of the
            measurements plus the problems that appear or disappear between them.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {roomLayouts.map((l) => (
              <button
                key={l.id}
                onClick={() => setCompare(l.id)}
                className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1 text-[12px] text-ink-200 hover:bg-ink-700"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
            {roomLayouts.length === 0 && (
              <span className="text-[12px] text-ink-600">Fork this arrangement to create one.</span>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  const thisName = layouts.find((l) => l.id === layoutId)?.name ?? 'Current';
  const otherName = layouts.find((l) => l.id === compareLayoutId)?.name ?? 'Other';

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <GitCompare size={12} /> Compare
        </span>
      }
      action={
        <button onClick={() => setCompare(null)} className="text-[11px] text-ink-500 hover:text-ink-200">
          clear
        </button>
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-[10.5px] uppercase tracking-wide text-ink-500">
          <span />
          <span className="w-14 text-right">{truncate(thisName)}</span>
          <span className="w-14 text-right">{truncate(otherName)}</span>
          <span className="w-12 text-right">Δ</span>
        </div>

        {rows.map((row) => {
          const delta = row.a - row.b;
          const improved = row.better === 'higher' ? delta > 0 : delta < 0;
          const neutral = Math.abs(delta) < 1e-6;
          return (
            <div
              key={row.label}
              title={row.hint}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-[color:var(--hairline)] py-1.5 last:border-0"
            >
              <span className="truncate text-[12.5px] text-ink-300">{row.label}</span>
              <span className="tabular w-14 text-right text-[12.5px] text-ink-100">
                {row.format(row.a)}
              </span>
              <span className="tabular w-14 text-right text-[12.5px] text-ink-400">
                {row.format(row.b)}
              </span>
              <span
                className={cn(
                  'tabular w-12 text-right text-[12px]',
                  neutral ? 'text-ink-600' : improved ? 'text-signal-green' : 'text-signal-red',
                )}
              >
                {neutral ? '—' : `${delta > 0 ? '+' : ''}${row.format(delta).replace('%', '')}${row.format(0).includes('%') ? '%' : ''}`}
              </span>
            </div>
          );
        })}

        {(onlyHere.length > 0 || onlyThere.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="rule-label mb-1.5">Only in {truncate(thisName, 22)}</div>
              {onlyHere.length === 0 && <p className="text-[11.5px] text-ink-600">Nothing new.</p>}
              <ul className="space-y-1">
                {onlyHere.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-300">
                    <span
                      className={cn(
                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                        f.severity === 'blocker' && 'bg-signal-red',
                        f.severity === 'warning' && 'bg-signal-amber',
                        f.severity === 'note' && 'bg-signal-blue',
                      )}
                    />
                    {f.title}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="rule-label mb-1.5 flex items-center gap-1">
                Solved by switching <ArrowRight size={10} />
              </div>
              {onlyThere.length === 0 && (
                <p className="text-[11.5px] text-ink-600">Nothing the other one avoids.</p>
              )}
              <ul className="space-y-1">
                {onlyThere.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-green" />
                    {f.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function truncate(s: string, n = 12) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
