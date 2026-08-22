'use client';

/**
 * The part that makes this a log rather than a toy.
 *
 * Each entry is pinned to a specific arrangement, carries the metrics as they
 * were at the time, and records the reasoning — so that in six months, when
 * you wonder again whether the sofa should face the window, the answer and the
 * reason it was rejected are both still there.
 */

import { useMemo, useState } from 'react';
import { BookMarked, Check, Minus, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Panel, TextInput, cn } from '@/components/ui/primitives';
import type { DecisionEntry, Verdict } from '@/lib/domain/types';
import { formatDate, relativeTime } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';
import type { Evaluation } from '@/lib/constraints/evaluate';

const VERDICTS: { value: Verdict; label: string; tone: 'good' | 'bad' | 'warn' | 'neutral' | 'brass' }[] = [
  { value: 'exploring', label: 'Exploring', tone: 'neutral' },
  { value: 'adopted', label: 'Adopted', tone: 'good' },
  { value: 'implemented', label: 'Actually did it', tone: 'good' },
  { value: 'parked', label: 'Parked', tone: 'warn' },
  { value: 'rejected', label: 'Rejected', tone: 'bad' },
];

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS.find((x) => x.value === verdict);
  return <Badge tone={v?.tone ?? 'neutral'}>{v?.label ?? verdict}</Badge>;
}

function ListEditor({
  items,
  onChange,
  placeholder,
  tone,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  tone: 'good' | 'bad';
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {tone === 'good' ? (
            <Plus size={11} className="shrink-0 text-signal-green" />
          ) : (
            <Minus size={11} className="shrink-0 text-signal-red" />
          )}
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-200">{item}</span>
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="shrink-0 text-ink-600 hover:text-signal-red"
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <TextInput
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onChange([...items, draft.trim()]);
            setDraft('');
          }
        }}
        className="h-7 w-full text-[12px]"
      />
    </div>
  );
}

export function DecisionLog({ evaluation }: { evaluation: Evaluation | null }) {
  const decisions = useStudio((s) => s.decisions);
  const layouts = useStudio((s) => s.layouts);
  const roomId = useStudio((s) => s.roomId);
  const layoutId = useStudio((s) => s.layoutId);
  const projectId = useStudio((s) => s.projectId);
  const compareLayoutId = useStudio((s) => s.compareLayoutId);
  const addDecision = useStudio((s) => s.addDecision);
  const deleteDecision = useStudio((s) => s.deleteDecision);
  const setVerdict = useStudio((s) => s.setVerdict);
  const selectLayout = useStudio((s) => s.selectLayout);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [pros, setPros] = useState<string[]>([]);
  const [cons, setCons] = useState<string[]>([]);
  const [verdict, setDraftVerdict] = useState<Verdict>('exploring');

  const entries = useMemo(
    () =>
      decisions
        .filter((d) => d.roomId === roomId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [decisions, roomId],
  );

  const layoutName = (id: string) => layouts.find((l) => l.id === id)?.name ?? 'deleted arrangement';

  const submit = async () => {
    if (!projectId || !roomId || !layoutId) return;
    await addDecision({
      projectId,
      roomId,
      layoutId,
      comparedToLayoutId: compareLayoutId ?? undefined,
      verdict,
      title: title.trim() || `Note on ${layoutName(layoutId)}`,
      rationale: rationale.trim(),
      pros,
      cons,
      tags: [],
      metrics: evaluation?.metrics,
    });
    setTitle('');
    setRationale('');
    setPros([]);
    setCons([]);
    setComposing(false);
  };

  // Pre-fill the cons from whatever the checks are currently complaining about.
  const suggestCons = () => {
    const suggestions = (evaluation?.findings ?? [])
      .filter((f) => f.severity !== 'note')
      .slice(0, 4)
      .map((f) => f.title);
    setCons((prev) => [...new Set([...prev, ...suggestions])]);
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <BookMarked size={12} /> Decision log
        </span>
      }
      action={
        <Button size="sm" variant={composing ? 'ghost' : 'subtle'} onClick={() => setComposing((v) => !v)}>
          {composing ? 'Cancel' : 'Record a decision'}
        </Button>
      }
      className="min-h-0"
    >
      {composing && (
        <div className="space-y-2.5 border-b border-[color:var(--hairline)] p-3">
          <TextInput
            autoFocus
            placeholder="What did you decide?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full"
          />
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder="Why. The bit you will not remember in three months."
            className="w-full resize-none rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:border-brass-500 focus:outline-none"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="rule-label mb-1">Worked</div>
              <ListEditor items={pros} onChange={setPros} placeholder="Add a plus, then Enter" tone="good" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="rule-label">Did not</span>
                <button onClick={suggestCons} className="text-[10.5px] text-brass-400 hover:underline">
                  pull from checks
                </button>
              </div>
              <ListEditor items={cons} onChange={setCons} placeholder="Add a minus, then Enter" tone="bad" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {VERDICTS.map((v) => (
              <button
                key={v.value}
                onClick={() => setDraftVerdict(v.value)}
                className={cn(
                  'rounded px-2 py-1 text-[11.5px] transition-colors',
                  verdict === v.value
                    ? 'bg-brass-500/20 text-brass-300'
                    : 'bg-ink-800 text-ink-400 hover:text-ink-100',
                )}
              >
                {v.label}
              </button>
            ))}
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => void submit()}>
              <Check size={12} /> Save entry
            </Button>
          </div>
          {evaluation && (
            <p className="text-[11px] leading-relaxed text-ink-500">
              Score {evaluation.metrics.score}, {evaluation.metrics.collisions} overlaps,{' '}
              {Math.round(evaluation.metrics.usableFloorRatio * 100)}% walkable floor and{' '}
              {evaluation.metrics.reachableOutlets}/{evaluation.metrics.totalOutletDemands} things
              plugged in will be stored with this entry.
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-ink-500">
            No entries yet. Every time you rule an arrangement in or out, write down why — that
            record is what stops you relitigating the same argument next year.
          </div>
        )}

        <ol className="relative space-y-2 pl-4">
          {entries.length > 0 && (
            <span className="absolute bottom-2 left-[5px] top-2 w-px bg-[color:var(--hairline)]" />
          )}
          {entries.map((entry) => (
            <DecisionCard
              key={entry.id}
              entry={entry}
              layoutName={layoutName(entry.layoutId)}
              comparedName={entry.comparedToLayoutId ? layoutName(entry.comparedToLayoutId) : null}
              onOpen={() => selectLayout(entry.layoutId)}
              onDelete={() => void deleteDecision(entry.id)}
              onVerdict={(v) => void setVerdict(entry.id, v)}
            />
          ))}
        </ol>
      </div>
    </Panel>
  );
}

function DecisionCard({
  entry,
  layoutName,
  comparedName,
  onOpen,
  onDelete,
  onVerdict,
}: {
  entry: DecisionEntry;
  layoutName: string;
  comparedName: string | null;
  onOpen: () => void;
  onDelete: () => void;
  onVerdict: (v: Verdict) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="group relative">
      <span
        className={cn(
          'absolute -left-4 top-3 h-2.5 w-2.5 rounded-full border-2 border-ink-900',
          entry.verdict === 'rejected' && 'bg-signal-red',
          entry.verdict === 'adopted' && 'bg-signal-green',
          entry.verdict === 'implemented' && 'bg-signal-green',
          entry.verdict === 'parked' && 'bg-signal-amber',
          entry.verdict === 'exploring' && 'bg-ink-500',
        )}
      />
      <div className="rounded-md border border-[color:var(--hairline)] bg-ink-900/50 p-2.5">
        <div className="flex items-start gap-2">
          <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded((v) => !v)}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-medium text-ink-100">{entry.title}</span>
              <VerdictBadge verdict={entry.verdict} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {layoutName}
              {comparedName && <> vs {comparedName}</>} · {formatDate(entry.createdAt)} ·{' '}
              {relativeTime(entry.createdAt)}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={onOpen}
              className="rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-ink-500 hover:bg-ink-700 hover:text-ink-100"
            >
              open
            </button>
            <button onClick={onDelete} className="rounded p-1 text-ink-600 hover:text-signal-red">
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {(expanded || entry.rationale.length < 130) && entry.rationale && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">{entry.rationale}</p>
        )}

        {expanded && (
          <>
            {(entry.pros.length > 0 || entry.cons.length > 0) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ul className="space-y-0.5">
                  {entry.pros.map((p, i) => (
                    <li key={i} className="flex gap-1.5 text-[11.5px] text-ink-300">
                      <Plus size={11} className="mt-0.5 shrink-0 text-signal-green" />
                      {p}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-0.5">
                  {entry.cons.map((c, i) => (
                    <li key={i} className="flex gap-1.5 text-[11.5px] text-ink-300">
                      <Minus size={11} className="mt-0.5 shrink-0 text-signal-red" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {entry.metrics && (
              <div className="tabular mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded bg-ink-950/50 p-2 text-[11px] text-ink-400 sm:grid-cols-4">
                <span>score {entry.metrics.score}</span>
                <span>{Math.round(entry.metrics.usableFloorRatio * 100)}% walkable</span>
                <span>{entry.metrics.collisions} overlaps</span>
                <span>
                  {entry.metrics.reachableOutlets}/{entry.metrics.totalOutletDemands} plugged in
                </span>
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {VERDICTS.map((v) => (
                <button
                  key={v.value}
                  onClick={() => onVerdict(v.value)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
                    entry.verdict === v.value
                      ? 'bg-brass-500/20 text-brass-300'
                      : 'bg-ink-800 text-ink-500 hover:text-ink-200',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </li>
  );
}
