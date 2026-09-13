'use client';

import type { ReactNode } from 'react';
import { cn } from '@/components/ui/primitives';

export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('mark', className)}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
      aria-hidden
    >
      S
    </span>
  );
}

export function HudFrame({
  children,
  caption,
  className,
}: {
  children: ReactNode;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={cn('hud-viewport h-full w-full', className)}>
      <i className="hud-corner tl" />
      <i className="hud-corner tr" />
      <i className="hud-corner bl" />
      <i className="hud-corner br" />
      {caption ? <div className="hud-caption">{caption}</div> : null}
      {children}
    </div>
  );
}

export function Meter({
  label,
  value,
  max,
  display,
  tone = 'good',
}: {
  label: string;
  value: number;
  max: number;
  display?: ReactNode;
  tone?: 'good' | 'fair' | 'poor';
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="min-w-[132px]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="rule-label">{label}</span>
        <span
          className={cn(
            'tabular text-[12px] font-semibold',
            tone === 'good' && 'text-signal-green',
            tone === 'fair' && 'text-signal-amber',
            tone === 'poor' && 'text-signal-red',
          )}
        >
          {display ?? `${Math.round(value)}/${Math.round(max)}`}
        </span>
      </div>
      <div className="meter-track">
        <div
          className={cn(
            'meter-fill',
            tone === 'fair' && 'warn',
            tone === 'poor' && 'bad',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Keycap({ children }: { children: ReactNode }) {
  return <span className="keycap">{children}</span>;
}
