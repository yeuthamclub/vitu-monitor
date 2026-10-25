/**
 * VN earthquake board mappers — the fork's PR-3b
 * (`vn:earthquakes:v1`, seeded by scripts/seed-vn-earthquakes.mjs from the
 * USGS FDSN API over the Vietnam bounding box).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapEnvelope(payload: unknown, marker?: string): unknown {
  if (!isRecord(payload)) return payload;
  if (marker !== undefined && marker in payload) return payload;
  if (isRecord(payload.data)) return payload.data;
  return payload;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export type VnEarthquakeRow = {
  /** USGS event id, stable per event. */
  id: string;
  magnitude: number;
  /** Human-readable place as USGS reports it, e.g. '33 km SE of Sơn La, Vietnam'. */
  place: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  /** Origin time, ISO. */
  time: string;
  /** USGS detail page when present. */
  url: string | null;
  tsunami: boolean;
};

/**
 * Project `vn:earthquakes:v1` onto rows, newest first. A malformed event is
 * dropped, not rendered half-formed; an empty board is a legitimate quiet
 * window and stays empty.
 *
 * @param payload the `vn:earthquakes:v1` value, enveloped or not
 */
export function toVnEarthquakeRows(payload: unknown): VnEarthquakeRow[] {
  const unwrapped = unwrapEnvelope(payload, 'events');
  if (!isRecord(unwrapped)) return [];
  const events = unwrapped.events;
  if (!Array.isArray(events)) return [];

  const rows: VnEarthquakeRow[] = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const id = nonEmptyString(event.id);
    const magnitude = finiteNumber(event.magnitude);
    const latitude = finiteNumber(event.latitude);
    const longitude = finiteNumber(event.longitude);
    const depthKm = finiteNumber(event.depthKm);
    const time = nonEmptyString(event.time);
    if (id === null || magnitude === null || magnitude <= 0
      || latitude === null || longitude === null || depthKm === null || depthKm < 0
      || time === null) continue;
    rows.push({
      id,
      magnitude,
      place: typeof event.place === 'string' ? event.place : '',
      latitude,
      longitude,
      depthKm,
      time,
      url: nonEmptyString(event.url),
      tsunami: event.tsunami === true,
    });
  }
  return rows.sort((a, b) => (a.time < b.time ? 1 : -1));
}
