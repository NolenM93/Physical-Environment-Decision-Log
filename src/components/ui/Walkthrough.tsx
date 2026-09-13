'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the control to highlight. Omit for a centered card. */
  target?: string;
  openTray?: 'add' | 'fix' | 'why' | 'flip' | 'compare' | 'room' | null;
}

export function Walkthrough({
  steps,
  active,
  onClose,
  onStep,
}: {
  steps: TourStep[];
  active: boolean;
  onClose: () => void;
  onStep?: (index: number, step: TourStep) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[index];
  const last = index >= steps.length - 1;

  const go = (next: number) => {
    if (next >= steps.length) {
      onClose();
      return;
    }
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    setIndex(clamped);
    onStep?.(clamped, steps[clamped]);
  };

  useEffect(() => {
    if (!active) return;
    setIndex(0);
    onStep?.(0, steps[0]);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, index, onClose]);

  useLayoutEffect(() => {
    if (!active || !step) return;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timer = window.setTimeout(measure, 80);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, step]);

  if (!active || !step) return null;

  const pad = 8;
  const highlight = rect
    ? {
        top: Math.max(8, rect.top - pad),
        left: Math.max(8, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const cardAtBottom = !highlight || highlight.top < window.innerHeight * 0.55;
  const cardStyle = cardAtBottom
    ? { bottom: 88, left: '50%', transform: 'translateX(-50%)' }
    : { top: 88, left: '50%', transform: 'translateX(-50%)' };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {highlight ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-brass-500"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: '0 0 0 9999px rgba(21, 32, 54, 0.52)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-ink-50/50" />
      )}
      {/* Keep clicks on the app blocked while the tour is up. */}
      <div className="absolute inset-0" />

      <div
        className="panel absolute z-[91] w-[min(360px,calc(100vw-32px))] p-4 shadow-xl"
        style={cardStyle}
      >
        <div className="rule-label mb-2">
          {index + 1} of {steps.length}
        </div>
        <h2 id="tour-title" className="font-display text-[22px] leading-tight text-ink-50">
          {step.title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-300">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-[12.5px] text-ink-500 hover:text-ink-200"
            onClick={onClose}
          >
            Skip
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button size="sm" variant="ghost" onClick={() => go(index - 1)}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={() => (last ? onClose() : go(index + 1))}
            >
              {last ? 'Start using it' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TOUR_DONE_KEY = 'stanza.tour.banquet.done';
const TOUR_START_KEY = 'stanza.tour.start';
const TOUR_SKIP_KEY = 'stanza.tour.skipOnce';

export function banquetTourWasDone() {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markBanquetTourDone() {
  try {
    localStorage.setItem(TOUR_DONE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function requestBanquetTour() {
  try {
    sessionStorage.setItem(TOUR_START_KEY, '1');
    sessionStorage.removeItem(TOUR_SKIP_KEY);
  } catch {
    /* ignore */
  }
}

export function skipBanquetTourOnce() {
  try {
    sessionStorage.setItem(TOUR_SKIP_KEY, '1');
    sessionStorage.removeItem(TOUR_START_KEY);
  } catch {
    /* ignore */
  }
}

export function consumeBanquetTourSkip() {
  try {
    if (sessionStorage.getItem(TOUR_SKIP_KEY) === '1') {
      sessionStorage.removeItem(TOUR_SKIP_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function consumeBanquetTourRequest() {
  try {
    if (sessionStorage.getItem(TOUR_START_KEY) === '1') {
      sessionStorage.removeItem(TOUR_START_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export const BANQUET_TOUR: TourStep[] = [
  {
    id: 'welcome',
    title: 'This is one wedding.',
    openTray: null,
    body: 'Same ballroom all night. You are not decorating — you are choosing how the room is set for each part of the evening, then handing that to the crew who actually move the furniture.',
  },
  {
    id: 'setups',
    target: '[data-tour="setups"]',
    title: 'Three setups, in order.',
    body: 'Ceremony, then reception, then dinner. Click one to see that layout on the floor. That is the whole night. Ignore anything else in this bar until you need it.',
  },
  {
    id: 'meters',
    target: '[data-tour="meters"]',
    title: 'Two numbers that matter.',
    body: 'Covers: can dinner seat the guest count? Aisle: is there a walk to the exits? If either is wrong, the layout is not ready to lock.',
  },
  {
    id: 'floor',
    target: '[data-tour="floor"]',
    openTray: null,
    title: 'The floor is the job.',
    body: 'Drag a table to move it. The small handle turns it. This is the measured ballroom — what the couple will walk, and what housemen will set.',
  },
  {
    id: 'stock',
    target: '[data-tour="hotbar"]',
    openTray: 'add',
    title: 'House stock, problems, reasons.',
    body: 'House stock puts another round or chair on the floor. Problems lists what is still wrong. Why we chose this is the written note sales leaves for ops. Flip list is the Saturday move order.',
  },
  {
    id: 'lock',
    target: '[data-tour="lock"]',
    openTray: null,
    title: 'When it is good enough, lock it.',
    body: 'Sales proposes. Issue to ops freezes the sheet so the floor crew gets one version. Print if you need paper in someone’s hand.',
  },
];
