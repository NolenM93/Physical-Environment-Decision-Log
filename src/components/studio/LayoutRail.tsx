'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, GitBranch, Layers, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Panel, TextInput, cn } from '@/components/ui/primitives';
import { useStudio } from '@/lib/store/studio';
import type { Layout, SetupKind } from '@/lib/domain/types';

const SETUP_LABEL: Record<SetupKind, string> = {
  ceremony: 'Ceremony',
  cocktail: 'Reception',
  reception: 'Reception',
  dinner: 'Dinner',
  dance: 'Dance',
  reset: 'Reset',
  other: 'Setup',
};
import { relativeTime } from '@/lib/format';

interface TreeNode {
  layout: Layout;
  depth: number;
}

function buildTree(layouts: Layout[]): TreeNode[] {
  const byParent = new Map<string | undefined, Layout[]>();
  for (const l of layouts) {
    const key = l.parentId && layouts.some((x) => x.id === l.parentId) ? l.parentId : undefined;
    const list = byParent.get(key) ?? [];
    list.push(l);
    byParent.set(key, list);
  }
  const out: TreeNode[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.createdAt - b.createdAt);
    for (const layout of children) {
      out.push({ layout, depth });
      walk(layout.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export function LayoutRail() {
  const layouts = useStudio((s) => s.layouts);
  const roomId = useStudio((s) => s.roomId);
  const layoutId = useStudio((s) => s.layoutId);
  const compareLayoutId = useStudio((s) => s.compareLayoutId);
  const decisions = useStudio((s) => s.decisions);
  const event = useStudio((s) => s.events.find((e) => e.id === s.eventId) ?? null);
  const selectLayout = useStudio((s) => s.selectLayout);
  const forkLayout = useStudio((s) => s.forkLayout);
  const renameLayout = useStudio((s) => s.renameLayout);
  const deleteLayout = useStudio((s) => s.deleteLayout);
  const markCurrent = useStudio((s) => s.markCurrent);
  const setCompare = useStudio((s) => s.setCompare);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const roomLayouts = useMemo(
    () => layouts.filter((l) => l.roomId === roomId),
    [layouts, roomId],
  );
  const tree = useMemo(() => {
    if (!event) return buildTree(roomLayouts);
    const setupSet = new Set(event.setupIds);
    const ordered = event.setupIds
      .map((id) => roomLayouts.find((l) => l.id === id))
      .filter((l): l is Layout => Boolean(l))
      .map((layout) => ({ layout, depth: 0 }));
    const extras = buildTree(roomLayouts.filter((l) => !setupSet.has(l.id)));
    return [...ordered, ...extras];
  }, [roomLayouts, event]);

  const verdictOf = (id: string) => {
    const entries = decisions.filter((d) => d.layoutId === id);
    return entries.length ? entries[entries.length - 1].verdict : null;
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Layers size={12} /> {event ? 'Setups' : 'Arrangements'}
        </span>
      }
      action={
        <Button
          size="sm"
          variant="subtle"
          onClick={() => void forkLayout(`Variant ${roomLayouts.length + 1}`)}
          title="Fork the current arrangement into a new branch"
        >
          <GitBranch size={12} /> Fork
        </Button>
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tree.length === 0 && (
          <EmptyState title="No arrangements yet">
            Capture a room, or start one from scratch, and every version you try will be listed here.
          </EmptyState>
        )}

        {tree.map(({ layout, depth }) => {
          const active = layout.id === layoutId;
          const comparing = layout.id === compareLayoutId;
          const verdict = verdictOf(layout.id);
          return (
            <div
              key={layout.id}
              style={{ paddingLeft: depth * 12 }}
              className="group relative"
            >
              {depth > 0 && (
                <span
                  className="absolute left-0 top-0 h-full border-l border-[color:var(--hairline)]"
                  style={{ left: depth * 12 - 6 }}
                />
              )}
              <div
                className={cn(
                  'mb-1 flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
                  active
                    ? 'border-brass-500/50 bg-brass-500/10'
                    : 'border-transparent hover:bg-ink-800',
                )}
              >
                <span
                  className="h-6 w-1 shrink-0 rounded-full"
                  style={{ background: layout.color }}
                />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => selectLayout(layout.id)}
                >
                  {renaming === layout.id ? (
                    <TextInput
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => {
                        void renameLayout(layout.id, draftName || layout.name);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="h-6 w-full"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate text-[13px]',
                            active ? 'text-ink-50' : 'text-ink-200',
                          )}
                        >
                          {layout.name}
                        </span>
                        {layout.setupKind && (
                          <Badge tone="neutral">{SETUP_LABEL[layout.setupKind]}</Badge>
                        )}
                        {layout.isCurrent && <Badge tone="brass">live</Badge>}
                        {verdict === 'rejected' && <Badge tone="bad">rejected</Badge>}
                        {verdict === 'adopted' && <Badge tone="good">adopted</Badge>}
                        {verdict === 'implemented' && <Badge tone="good">done</Badge>}
                      </div>
                      <div className="tabular text-[10.5px] text-ink-500">
                        {layout.items.length} pieces · {relativeTime(layout.updatedAt)}
                      </div>
                    </>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    title={comparing ? 'Stop comparing' : 'Compare against this'}
                    onClick={() => setCompare(comparing ? null : layout.id)}
                    className={cn(
                      'rounded p-1 hover:bg-ink-700',
                      comparing ? 'text-brass-400' : 'text-ink-500',
                    )}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    title="Rename"
                    onClick={() => {
                      setRenaming(layout.id);
                      setDraftName(layout.name);
                    }}
                    className="rounded p-1 text-ink-500 hover:bg-ink-700"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    title="Mark as how the room actually is"
                    onClick={() => void markCurrent(layout.id)}
                    className="rounded p-1 text-ink-500 hover:bg-ink-700"
                  >
                    <Check size={12} />
                  </button>
                  {roomLayouts.length > 1 && (
                    <button
                      title="Delete"
                      onClick={() => void deleteLayout(layout.id)}
                      className="rounded p-1 text-ink-500 hover:bg-ink-700 hover:text-signal-red"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {compareLayoutId && (
        <div className="border-t border-[color:var(--hairline)] px-3 py-2 text-[11px] text-ink-400">
          Comparing against{' '}
          <span className="text-brass-300">
            {roomLayouts.find((l) => l.id === compareLayoutId)?.name}
          </span>
          . Turn on the ghost overlay to see both at once.
        </div>
      )}
    </Panel>
  );
}
