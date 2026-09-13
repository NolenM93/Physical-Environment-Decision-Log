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
} from 'lucide-react';
import { Button, cn } from '@/components/ui/primitives';
import { Mark } from '@/components/ui/hud';
import { requestBanquetTour, skipBanquetTourOnce } from '@/components/ui/Walkthrough';
import { db, deleteProject } from '@/lib/db';
import { seedDemoProject, seedHarborProject } from '@/lib/db/seed';
import type { Project } from '@/lib/domain/types';
import { relativeTime } from '@/lib/format';

const PILLARS = [
  {
    icon: Ruler,
    title: 'The ballroom, measured',
    body: 'One function space, in metres. Reception and dinner sit on the same floor so the couple is not choosing from a sketch.',
  },
  {
    icon: Compass,
    title: 'Covers and aisle',
    body: 'Dinner must seat the guarantee. The walk to the exits is a house rule, not a fire cert. Reception is standing.',
  },
  {
    icon: BookMarked,
    title: 'Why longs lost',
    body: 'Every rejected dinner stays on the event. Ops can see why the BEO changed without calling sales.',
  },
  {
    icon: Route,
    title: 'The Saturday flip',
    body: 'Reception to dinner is an ordered list: what moves, how long, how many housemen. Print it. Hand it over.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState<'harbor' | 'demo' | null>(null);
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
    setBusy('demo');
    const id = await seedDemoProject();
    router.push(`/studio?project=${id}`);
  };

  const openHarbor = async (withTour = false) => {
    setBusy('harbor');
    if (withTour) requestBanquetTour();
    else skipBanquetTourOnce();
    const id = await seedHarborProject();
    router.push(`/studio?project=${id}`);
  };

  return (
    <div className="paper-grid min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <Mark size={30} />
            <div>
              <div className="font-display text-[20px] leading-none text-ink-50">Stanza</div>
              <div className="mt-0.5 text-[11px] tracking-wide text-ink-500">
                Banquet sales to service
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/new">
              <Button variant="outline" size="sm">
                New room
              </Button>
            </Link>
            <Link href="/capture">
              <Button variant="outline" size="sm">
                <Camera size={13} /> Capture a room
              </Button>
            </Link>
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="rule-label mb-4">A banquet floor, in plain terms</p>
            <h1 className="wordmark text-[42px] leading-[1.08] sm:text-[54px]">
              Design the reception
              <br />
              <span className="text-brass-400">and the dinner.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-300">
              This is a floor plan for a hotel ballroom. You place the tables, check that everyone
              has a seat and a walk to the door, then print the list of what to move when the
              party changes from drinks to dinner.
            </p>
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-500">
              Open the sample wedding and we will walk the screen with you. Nothing leaves this
              browser.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                onClick={() => void openHarbor(true)}
                disabled={Boolean(busy)}
              >
                {busy === 'harbor' ? <Loader2 size={15} className="animate-spin" /> : null}
                Show me how it works <ArrowRight size={15} />
              </Button>
              <Button variant="outline" size="lg" onClick={() => void openHarbor(false)} disabled={Boolean(busy)}>
                Open without the walkthrough
              </Button>
              <Button variant="outline" size="lg" onClick={() => void openDemo()} disabled={Boolean(busy)}>
                {busy === 'demo' ? <Loader2 size={15} className="animate-spin" /> : null}
                Flat 3B living room
              </Button>
              <Link href="/new">
                <Button variant="outline" size="lg">
                  Draw your own room
                </Button>
              </Link>
              <Link href="/capture">
                <Button variant="outline" size="lg">
                  <Camera size={15} /> Start with a photograph
                </Button>
              </Link>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-4 py-3">
              <span className="rule-label">Your rooms</span>
              <span className="tabular text-[11px] text-ink-500">
                {projects === null ? '…' : `${projects.length}`}
              </span>
            </div>
            <div className="max-h-[380px] overflow-y-auto p-2">
              {projects === null && (
                <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-ink-500">
                  <Loader2 size={13} className="animate-spin" /> reading local storage…
                </div>
              )}
              {projects?.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="font-display text-[18px] text-ink-200">Nothing saved yet.</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                    Open the Miller wedding, draw a room to size, try the living-room example, or
                    capture a room of your own.
                  </p>
                </div>
              )}
              {projects?.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-ink-800"
                >
                  <Link href={`/studio?project=${p.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[14px] text-ink-100">{p.name}</div>
                    <div className="text-[11.5px] text-ink-500">
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

        <section className="mb-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              n: '1',
              title: 'Pick the part of the night',
              body: 'Ceremony, reception, or dinner. Same room. Click the name to see that setup on the floor.',
            },
            {
              n: '2',
              title: 'Move tables until the numbers work',
              body: 'Covers = seats for the guest count. Aisle = a walk to the exits. Drag furniture. House stock adds another piece from the hotel.',
            },
            {
              n: '3',
              title: 'Lock it and print the flip',
              body: 'Issue to ops freezes the sheet. The flip list is what housemen move when reception becomes dinner.',
            },
          ].map((step) => (
            <div key={step.n} className="panel p-5">
              <div className="tabular text-[12px] text-brass-500">{step.n}</div>
              <h3 className="font-display mt-2 text-[18px] text-ink-50">{step.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="mb-10 grid gap-px overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-ink-900 p-5">
              <Icon size={17} className="text-brass-400" />
              <h3 className="font-display mt-3 text-[18px] text-ink-100">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">{body}</p>
            </div>
          ))}
        </section>

        <section className="pb-10">
          <h2 className="font-display text-[22px] text-ink-100">
            What one photograph can and cannot tell you
          </h2>
          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <div className="panel p-5">
              <div className="rule-label mb-2 text-verdigris-400">Genuinely measured</div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-400">
                <li>Where each object stands on the floor, in metres from the camera</li>
                <li>Its width, from the two ends of its floor contact line</li>
                <li>Its height, from the viewing ray to the vertical through its base</li>
                <li>The walls, from the floor quad you confirm</li>
                <li>The camera&apos;s focal length, pitch and roll</li>
              </ul>
            </div>
            <div className="panel p-5">
              <div className="rule-label mb-2 text-signal-amber">Inferred, and labelled as such</div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-400">
                <li>How deep anything is — the far side is hidden in a single view</li>
                <li>Mass, from category density and bounding volume</li>
                <li>Anything wholly occluded by something in front of it</li>
                <li>Absolute scale, which rests entirely on the lens height you give it</li>
              </ul>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
                Every reconstructed piece carries its own provenance note and a confidence figure.
                The app would rather be corrected than believed.
              </p>
            </div>
          </div>
        </section>

        <footer
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] py-5 text-[12px] text-ink-600',
          )}
        >
          <span>Stanza · everything stays in this browser</span>
          <span>Metric calibration under a Manhattan-world assumption</span>
        </footer>
      </div>
    </div>
  );
}
