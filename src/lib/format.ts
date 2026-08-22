import type { UnitSystem } from './domain/types';

const INCH = 0.0254;

export function formatLength(metres: number, units: UnitSystem = 'metric', precise = false): string {
  if (!Number.isFinite(metres)) return '—';
  if (units === 'imperial') {
    const totalInches = metres / INCH;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches - feet * 12;
    if (feet === 0) return `${inches.toFixed(precise ? 1 : 0)}"`;
    return `${feet}' ${inches.toFixed(precise ? 1 : 0)}"`;
  }
  if (Math.abs(metres) < 1) return `${(metres * 100).toFixed(precise ? 1 : 0)} cm`;
  return `${metres.toFixed(precise ? 3 : 2)} m`;
}

export function formatArea(m2: number, units: UnitSystem = 'metric'): string {
  if (!Number.isFinite(m2)) return '—';
  if (units === 'imperial') return `${(m2 * 10.7639).toFixed(1)} ft²`;
  return `${m2.toFixed(1)} m²`;
}

export function formatMass(kg: number, units: UnitSystem = 'metric'): string {
  if (!Number.isFinite(kg)) return '—';
  if (units === 'imperial') return `${Math.round(kg * 2.20462)} lb`;
  return `${kg < 10 ? kg.toFixed(1) : Math.round(kg)} kg`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDegrees(rad: number): string {
  const deg = ((rad * 180) / Math.PI) % 360;
  return `${Math.round(deg < 0 ? deg + 360 : deg)}°`;
}

export function formatClock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = delta / 60000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d ago`;
  const months = days / 30.44;
  if (months < 12) return `${Math.round(months)} mo ago`;
  return `${(months / 12).toFixed(1)} y ago`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
