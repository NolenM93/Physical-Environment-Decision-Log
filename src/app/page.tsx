'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookMarked,
  Camera,
  Compass,
  Loader2,
  Ruler,
  Route,
  Trash2,
  Sun,
} from 'lucide-react';
import { Button, cn } from '@/components/ui/primitives';
import { db, deleteProject } from '@/lib/db';
import { seedDemoProject } from '@/lib/db/seed';
import type { Project } from '@/lib/domain/types';
import { relativeTime } from '@/lib/format';

const PILLARS = [
  {
    icon: Ruler,
    title: 'Measured, not sketched',
    body: 'Line segments in your photograph are clustered into vanishing points, the focal length falls out of the orthogonality constraint, and every floor pixel back-projects to real metres. The numbers are derived, not typed in.',
  },
  {
    icon: Compass,
    title: 'Constraints, not decoration',
    body: 'Door swings, walking width, sockets within cord reach, a clear side to get out of bed, viewing angles, where the sun actually lands at four in the afternoon. The things that decide whether a layout survives a week.',
  },
  {
    icon: BookMarked,
    title: 'A log, not a session',
    body: 'Every arrangement is a branch you can return to, carrying the reasoning and the measurements as they stood when you judged it. The record is the product.',
  },
  {
    icon: Route,
    title: 'Ends in instructions',
    body: 'Choose a layout and get an ordered plan: what to shift, in what sequence, how far, how many people, and which piece has to be turned on edge to make it through the gap.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
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

  const openDemo = async () => {
    setBusy(true);
    const id = await seedDemoProject();
    router.push(`/studio?project=${id}`);
  };

  return (
    <div className="paper-grid min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brass-500 text-[16px] font-semibold text-ink-950">
              S
            </span>
            <div>
              <div className="text-[15px] font-medium tracking-tight text-ink-50">Stanza</div>
              <div className="text-[11px] text-ink-500">a spatial decision log</div>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/capture">
              <Button variant="outline" size="sm">
                <Camera size={13} /> Capture a room
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => void openDemo()} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Open the worked example
            </Button>
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="rule-label mb-4">For the furniture you already own</p>
            <h1 className="text-[40px] font-medium leading-[1.08] tracking-tight text-ink-50 sm:text-[52px]">
              Move the sofa
              <br />
              <span className="text-brass-400">before you move the sofa.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-300">
              Photograph a room. Stanza reconstructs it to scale from that single image, lets you
              rearrange what is already in it, and tells you what each arrangement would actually be
              like to live in — then keeps the record of why you chose what you chose.
            </p>
            <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-ink-500">
              No catalogue, no shopping, no style transfer. Just your things, measured properly, and
              the reasoning written down.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => void openDemo()} disabled={busy}>
                Explore a real room <ArrowRight size={15} />
              </Button>
              <Link href="/capture">
                <Button variant="outline" size="lg">
                  <Camera size={15} /> Start with your own photo
                </Button>
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-ink-500">
              <span className="flex items-center gap-1.5">
                <Sun size={12} /> Sun path from your latitude
              </span>
              <span className="flex items-center gap-1.5">
                <Ruler size={12} /> Single-image metric calibration
              </span>
              <span className="flex items-center gap-1.5">
                <BookMarked size={12} /> Stored on this device only
              </span>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-[color:var(--hairline)] px-4 py-3">
              <span className="rule-label">Your rooms</span>
            </div>
            <div className="max-h-[380px] overflow-y-auto p-2">
              {projects === null && (
                <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-ink-500">
                  <Loader2 size={13} className="animate-spin" /> reading local storage…
                </div>
              )}
              {projects?.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="text-[13px] text-ink-300">Nothing saved yet.</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                    Open the worked example to see a real living room with its history intact, or
                    capture your own.
                  </p>
                </div>
              )}
              {projects?.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-ink-800"
                >
                  <Link href={`/studio?project=${p.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink-100">{p.name}</div>
                    <div className="text-[11px] text-ink-500">
                      updated {relativeTime(p.updatedAt)} · {p.unitSystem}
                    </div>
                  </Link>
                  <button
                    onClick={async () => {
                      await deleteProject(p.id);
                      setReloadToken((t) => t + 1);
                    }}
                    className="shrink-0 rounded p-1.5 text-ink-600 opacity-0 transition-opacity hover:text-signal-red group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ArrowRight size={14} className="shrink-0 text-ink-600" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-ink-900 p-5">
              <Icon size={17} className="text-brass-400" />
              <h3 className="mt-3 text-[13.5px] font-medium text-ink-100">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">{body}</p>
            </div>
          ))}
        </section>

        <section className="py-12">
          <h2 className="text-[13px] font-medium tracking-tight text-ink-200">
            What one photograph can and cannot tell you
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="rule-label mb-2 text-verdigris-400">Genuinely measured</div>
              <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-400">
                <li>· Where each object stands on the floor, in metres from the camera</li>
                <li>· Its width, from the two ends of its floor contact line</li>
                <li>· Its height, from the closest approach of the viewing ray to the vertical through its base</li>
                <li>· The walls, from the floor quad you confirm</li>
                <li>· The camera&apos;s focal length, pitch and roll</li>
              </ul>
            </div>
            <div>
              <div className="rule-label mb-2 text-signal-amber">Inferred, and labelled as such</div>
              <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-400">
                <li>· How deep anything is — the far side is hidden in a single view</li>
                <li>· Mass, from category density and bounding volume</li>
                <li>· Anything wholly occluded by something in front of it</li>
                <li>· Absolute scale, which rests entirely on the lens height you give it</li>
              </ul>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
                Every reconstructed piece carries its own provenance note and a confidence figure, and
                all of it is editable. The app would rather be corrected than believed.
              </p>
            </div>
          </div>
        </section>

        <footer
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] py-5 text-[11.5px] text-ink-600',
          )}
        >
          <span>Stanza · everything stays in this browser</span>
          <span>Metric calibration under a Manhattan-world assumption · NOAA solar position</span>
        </footer>
      </div>
    </div>
  );
}
