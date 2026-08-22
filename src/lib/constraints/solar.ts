/**
 * Where the sun actually lands on your floor.
 *
 * Solar position uses the low-precision NOAA/Astronomical Almanac series
 * (accurate to roughly 0.01° over 1950-2050 — far below the error in anyone's
 * estimate of which way their flat faces). We then project each window opening
 * along the sun vector onto the floor plane to get the lit patch, clip it to
 * the room, and subtract nothing: the point is to show where light *would*
 * fall, so you can decide whether the reading chair belongs there.
 */

import { type Vec2, clamp, v2 } from '../geometry/vec';
import { type Polygon, clipPolygon, convexHull, polygonArea } from '../geometry/shapes';
import type { RoomFeature } from '../domain/types';

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Radians above the horizon; negative means the sun is down. */
  altitude: number;
  /** Radians clockwise from true north. */
  azimuth: number;
}

function toJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const n = toJulian(date) - 2451545.0;

  const meanLongitude = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmstDeg = (gmstHours * 15 + longitude + 360000) % 360;
  const hourAngle = (lmstDeg * RAD - rightAscension);

  const lat = latitude * RAD;
  const sinDec = Math.sin(declination);
  const cosDec = Math.cos(declination);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  // Local east-north-up components of the sun direction.
  const east = -cosDec * Math.sin(hourAngle);
  const north = sinDec * cosLat - cosDec * sinLat * Math.cos(hourAngle);
  const up = sinDec * sinLat + cosDec * cosLat * Math.cos(hourAngle);

  return {
    altitude: Math.asin(clamp(up, -1, 1)),
    azimuth: (Math.atan2(east, north) + Math.PI * 2) % (Math.PI * 2),
  };
}

/**
 * Convert a compass bearing to a direction in room plan coordinates.
 * `northAngle` is the bearing that plan +Y (depth) points toward.
 */
export function bearingToPlan(bearingRad: number, northAngleDeg: number): Vec2 {
  const theta = bearingRad - northAngleDeg * RAD;
  return v2(Math.sin(theta), Math.cos(theta));
}

/**
 * The instant corresponding to a wall clock reading in the room.
 *
 * Sun position depends on the absolute instant, so a slider set to 15:30 has to
 * mean 15:30 *there*. Reading it in the device's timezone silently moves the sun
 * by however many hours separate you from the room — enough, at either end of a
 * summer day, to lose it below the horizon entirely.
 */
export function localClockToInstant(
  dateISO: string,
  hour: number,
  utcOffsetMinutes: number,
): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, Math.round(hour * 60) - utcOffsetMinutes));
}

/** The device's current offset, as a starting guess for a room you just photographed. */
export function deviceUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export interface SunPatch {
  featureId: string;
  polygon: Polygon;
  areaM2: number;
  /** 0..1 — how directly the light hits, folding in incidence angle. */
  intensity: number;
}

export interface DaylightOptions {
  room: Polygon;
  features: RoomFeature[];
  latitude: number;
  longitude: number;
  northAngle: number;
  date: Date;
}

/**
 * Project every window onto the floor along the current sun vector.
 * Returns one patch per window that is actually facing the sun.
 */
export function computeSunPatches(options: DaylightOptions): {
  sun: SunPosition;
  patches: SunPatch[];
  planDirection: Vec2;
} {
  const { room, features, latitude, longitude, northAngle, date } = options;
  const sun = sunPosition(date, latitude, longitude);
  const planDirection = bearingToPlan(sun.azimuth, northAngle);
  const patches: SunPatch[] = [];

  if (sun.altitude <= 2 * RAD) return { sun, patches, planDirection };

  const tanAlt = Math.tan(sun.altitude);

  for (const f of features) {
    if (f.kind !== 'window' && f.kind !== 'sliding_door') continue;

    const facing = v2(Math.cos(f.facing), Math.sin(f.facing));
    // Light enters only when the sun sits on the outside of the wall.
    const alignment = -(planDirection.x * facing.x + planDirection.y * facing.y);
    if (alignment <= 0.02) continue;

    const along = v2(-facing.y, facing.x);
    const half = f.width / 2;
    const base = v2(f.position.x, f.position.y);

    const corners: Array<{ plan: Vec2; y: number }> = [
      { plan: v2(base.x - along.x * half, base.y - along.y * half), y: f.sillHeight },
      { plan: v2(base.x + along.x * half, base.y + along.y * half), y: f.sillHeight },
      { plan: v2(base.x + along.x * half, base.y + along.y * half), y: f.sillHeight + f.height },
      { plan: v2(base.x - along.x * half, base.y - along.y * half), y: f.sillHeight + f.height },
    ];

    const projected = corners.map((c) => {
      const run = c.y / tanAlt;
      return v2(c.plan.x - planDirection.x * run, c.plan.y - planDirection.y * run);
    });

    const patch = clipPolygon(convexHull(projected), room);
    if (patch.length < 3) continue;
    const area = polygonArea(patch);
    if (area < 0.02) continue;

    patches.push({
      featureId: f.id,
      polygon: patch,
      areaM2: area,
      intensity: clamp(alignment * Math.sin(sun.altitude) * 1.35, 0, 1),
    });
  }

  return { sun, patches, planDirection };
}

export interface DaylightTimeline {
  hour: number;
  label: string;
  altitude: number;
  litAreaM2: number;
  patches: SunPatch[];
}

/** Sample the day at fixed hours so the UI can scrub or overlay them all. */
export function daylightTimeline(
  options: Omit<DaylightOptions, 'date'>,
  date: Date,
  hours: number[] = [7, 9, 11, 13, 15, 17, 19],
): DaylightTimeline[] {
  return hours.map((hour) => {
    const at = new Date(date);
    at.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    const { sun, patches } = computeSunPatches({ ...options, date: at });
    return {
      hour,
      label: `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`,
      altitude: sun.altitude,
      litAreaM2: patches.reduce((s, p) => s + p.areaM2, 0),
      patches,
    };
  });
}

export const SOLSTICE_DATES = {
  /** Northern-hemisphere shorthand; the maths works either way. */
  winter: (year: number) => new Date(year, 11, 21, 12, 0, 0),
  summer: (year: number) => new Date(year, 5, 21, 12, 0, 0),
  equinox: (year: number) => new Date(year, 2, 20, 12, 0, 0),
};
