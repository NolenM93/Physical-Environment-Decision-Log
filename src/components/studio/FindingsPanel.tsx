'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { Badge, Panel, Stat, cn } from '@/components/ui/primitives';
import type { Evaluation, Severity } from '@/lib/constraints/evaluate';
import { useStudio } from '@/lib/store/studio';

const ICONS: Record<Severity, React.ComponentType<{ size?: number; className?: string }>> = {
  blocker: CircleAlert,
  warning: AlertTriangle,
  note: Info,
};

export function ReadoutStrip({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return null;
  return (
    <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        label="Layout score"
        value={evaluation.metrics.score}
        tone={
          evaluation.metrics.score > 78 ? 'good' : evaluation.metrics.score > 55 ? 'fair' : 'poor'
        }
        hint="Composite of every check below. Useful for ranking, not for arguing with."
      />
      {evaluation.readouts.map((r) => (
        <Stat key={r.label} label={r.label} value={r.value} hint={r.hint} tone={r.tone} />
      ))}
    </div>
  );
}

export function FindingsPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const setSelection = useStudio((s) => s.setSelection);
  const setHovered = useStudio((s) => s.setHovered);
  const [filter, setFilter] = useState<Severity | 'all'>('all');

  const counts = useMemo(() => {
    const c = { blocker: 0, warning: 0, note: 0 };
    for (const f of evaluation?.findings ?? []) c[f.severity]++;
    return c;
  }, [evaluation]);

  const findings = (evaluation?.findings ?? []).filter(
    (f) => filter === 'all' || f.severity === filter,
  );

  return (
    <Panel
      title="Checks"
      action={
        <div className="flex items-center gap-1">
          {(['all', 'blocker', 'warning', 'note'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide transition-colors',
                filter === key ? 'bg-ink-700 text-ink-50' : 'text-ink-500 hover:text-ink-200',
              )}
            >
              {key === 'all'
                ? 'all'
                : `${key === 'blocker' ? counts.blocker : key === 'warning' ? counts.warning : counts.note}`}
              {key !== 'all' && (
                <span
                  className={cn(
                    'ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle',
                    key === 'blocker' && 'bg-signal-red',
                    key === 'warning' && 'bg-signal-amber',
                    key === 'note' && 'bg-signal-blue',
                  )}
                />
              )}
            </button>
          ))}
        </div>
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {findings.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-ink-500">
            {counts.blocker + counts.warning + counts.note === 0
              ? 'Nothing to flag. Doors open, routes are clear, everything can be reached and plugged in.'
              : 'Nothing at this severity.'}
          </div>
        )}
        {findings.map((f) => {
          const Icon = ICONS[f.severity];
          return (
            <button
              key={f.id}
              onClick={() => setSelection(f.itemIds.slice(0, 1))}
              onMouseEnter={() => setHovered(f.itemIds[0] ?? null)}
              onMouseLeave={() => setHovered(null)}
              className="mb-1 flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-ink-800"
            >
              <Icon
                size={14}
                className={cn(
                  'mt-0.5 shrink-0',
                  f.severity === 'blocker' && 'text-signal-red',
                  f.severity === 'warning' && 'text-signal-amber',
                  f.severity === 'note' && 'text-signal-blue',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink-100">{f.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">
                  {f.detail}
                </span>
                {f.measured && (
                  <span className="tabular mt-1 inline-block text-[10.5px] text-ink-500">
                    {f.measured.value.toFixed(2)} {f.measured.unit} ·{' '}
                    {f.measured.comparison === 'min' ? 'wants at least' : 'wants at most'}{' '}
                    {f.measured.target.toFixed(2)} {f.measured.unit}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {evaluation && (
        <footer className="flex items-center gap-2 border-t border-[color:var(--hairline)] px-3 py-2">
          <Badge tone={counts.blocker ? 'bad' : 'good'}>{counts.blocker} blocking</Badge>
          <Badge tone={counts.warning ? 'warn' : 'neutral'}>{counts.warning} warnings</Badge>
          <Badge tone="neutral">{counts.note} notes</Badge>
        </footer>
      )}
    </Panel>
  );
}
