'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { db, deleteProject } from '@/lib/db';
import { seedDemoProject, seedHarborProject } from '@/lib/db/seed';
import type { Project } from '@/lib/domain/types';
import { relativeTime } from '@/lib/format';

export default function LandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState<'wedding' | 'room' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    db()
      .projects.orderBy('updatedAt')
      .reverse()
      .toArray()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const openWedding = async () => {
    setBusy('wedding');
    const id = await seedHarborProject();
    router.push(`/studio?project=${id}`);
  };

  const openRoom = async () => {
    setBusy('room');
    const id = await seedDemoProject();
    router.push(`/studio?project=${id}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <header className="mx-auto flex w-full max-w-lg items-center gap-2.5 px-6 py-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brass-500 text-[17px] font-semibold text-ink-950">
          S
        </span>
        <span className="text-[17px] font-medium tracking-tight text-ink-50">Stanza</span>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pb-16">
        <h1 className="text-[40px] font-medium leading-[1.1] tracking-tight text-ink-50">
          Plan the room.
          <br />
          <span className="text-brass-400">Drag the furniture.</span>
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-400">
          See if everyone fits. See what to move. That is the whole app.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            className="h-12 w-full justify-between px-4 text-[15px]"
            onClick={() => void openWedding()}
            disabled={Boolean(busy)}
          >
            <span className="flex items-center gap-2">
              {busy === 'wedding' && <Loader2 size={16} className="animate-spin" />}
              Try a sample wedding
            </span>
            <ArrowRight size={16} />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 w-full justify-between px-4 text-[15px]"
            onClick={() => void openRoom()}
            disabled={Boolean(busy)}
          >
            <span className="flex items-center gap-2">
              {busy === 'room' && <Loader2 size={16} className="animate-spin" />}
              Try a living room
            </span>
            <ArrowRight size={16} />
          </Button>
          <Link href="/new" className="w-full">
            <Button variant="outline" size="lg" className="h-12 w-full justify-between px-4 text-[15px]">
              <span>Draw your own room</span>
              <ArrowRight size={16} />
            </Button>
          </Link>
          <Link href="/capture" className="w-full">
            <Button variant="outline" size="lg" className="h-12 w-full justify-between px-4 text-[15px]">
              <span className="flex items-center gap-2">
                <Camera size={16} /> Use your own photo
              </span>
              <ArrowRight size={16} />
            </Button>
          </Link>
        </div>

        <section className="mt-14">
          <h2 className="text-[13px] font-medium text-ink-500">Your rooms</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--hairline)]">
            {projects === null && (
              <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-ink-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            )}
            {projects?.length === 0 && (
              <p className="px-4 py-8 text-center text-[14px] text-ink-500">
                Nothing saved yet. Open a sample, or start from a photo.
              </p>
            )}
            {projects?.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-3 border-t border-[color:var(--hairline)] first:border-t-0 px-4 py-3.5 hover:bg-ink-900"
              >
                <Link href={`/studio?project=${p.id}`} className="min-w-0 flex-1">
                  <div className="truncate text-[15px] text-ink-100">{p.name}</div>
                  <div className="text-[12px] text-ink-500">Updated {relativeTime(p.updatedAt)}</div>
                </Link>
                <button
                  onClick={async () => {
                    await deleteProject(p.id);
                    setReloadToken((t) => t + 1);
                  }}
                  className="rounded-md p-2 text-ink-600 opacity-0 hover:bg-ink-800 hover:text-signal-red group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
                <ArrowRight size={15} className="shrink-0 text-ink-600" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
