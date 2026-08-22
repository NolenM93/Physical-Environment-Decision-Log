'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export const cn = (...parts: unknown[]) => twMerge(clsx(parts));

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors select-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-400',
        'disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'h-7 px-2.5 text-[12px]',
        size === 'md' && 'h-9 px-3.5 text-[13px]',
        size === 'lg' && 'h-11 px-5 text-[14px]',
        variant === 'primary' && 'bg-brass-500 text-ink-950 hover:bg-brass-400',
        variant === 'ghost' && 'text-ink-200 hover:bg-ink-800 hover:text-ink-50',
        variant === 'subtle' && 'bg-ink-800 text-ink-100 hover:bg-ink-750',
        variant === 'outline' &&
          'border border-[color:var(--hairline)] text-ink-200 hover:bg-ink-800 hover:text-ink-50',
        variant === 'danger' && 'bg-signal-red/15 text-signal-red hover:bg-signal-red/25',
        className,
      )}
    />
  );
}

export function Panel({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={cn('panel flex flex-col min-h-0', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[color:var(--hairline)] shrink-0">
          <span className="rule-label">{title}</span>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-md bg-ink-850 p-0.5 border border-[color:var(--hairline)]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2.5 h-7 rounded text-[12px] font-medium transition-colors',
            value === o.value ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:text-ink-100',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      title={hint}
      className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] text-ink-200 hover:bg-ink-800"
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brass-500' : 'bg-ink-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-ink-950 transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="rule-label">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-ink-400">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2.5 text-[13px] text-ink-100',
        'placeholder:text-ink-500 focus:border-brass-500 focus:outline-none',
        className,
      )}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  step = 0.01,
  suffix,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        {...props}
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className={cn(
          'tabular h-8 w-full rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2.5 text-[13px] text-ink-100',
          'focus:border-brass-500 focus:outline-none',
          suffix && 'pr-8',
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brass';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide uppercase',
        tone === 'neutral' && 'bg-ink-800 text-ink-300',
        tone === 'good' && 'bg-signal-green/15 text-signal-green',
        tone === 'warn' && 'bg-signal-amber/15 text-signal-amber',
        tone === 'bad' && 'bg-signal-red/15 text-signal-red',
        tone === 'brass' && 'bg-brass-500/15 text-brass-300',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'fair' | 'poor' | 'neutral';
}) {
  return (
    <div className="rounded-md border border-[color:var(--hairline)] bg-ink-900/60 px-2.5 py-2" title={hint}>
      <div className="rule-label truncate">{label}</div>
      <div
        className={cn(
          'tabular mt-0.5 text-[15px] font-medium',
          tone === 'good' && 'text-signal-green',
          tone === 'fair' && 'text-signal-amber',
          tone === 'poor' && 'text-signal-red',
          tone === 'neutral' && 'text-ink-100',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10.5px] leading-tight text-ink-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-ink-600">{icon}</div>}
      <div className="text-[13px] font-medium text-ink-200">{title}</div>
      {children && <div className="max-w-xs text-[12px] leading-relaxed text-ink-500">{children}</div>}
    </div>
  );
}
