/**
 * NCHMF weather warning board mappers — the fork's PR-3a
 * (`vn:weather-warnings:v1`, seeded by scripts/seed-vn-weather-warnings.mjs
 * from the national hydromet service homepage). Rows are the service's own
 * bulletin titles with kind classified by its severity vocabulary.
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

export type VnWeatherWarningKind = 'warning' | 'forecast';

export type VnWeatherWarningRow = {
  /** NCHMF post id — monotone with publication, doubles as ordering. */
  postId: number;
  /** Bulletin title as published, e.g. 'TIN CẢNH BÁO LŨ QUÉT…'. */
  title: string;
  /** Absolute bulletin URL on nchmf.gov.vn. */
  url: string;
  /** Classified by the service's own title vocabulary. */
  kind: VnWeatherWarningKind;
};

/**
 * Project `vn:weather-warnings:v1` onto rows, hazard items first then newest
 * post first. A malformed item is dropped, not rendered half-formed.
 *
 * @param payload the `vn:weather-warnings:v1` value, enveloped or not
 */
export function toVnWeatherWarningRows(payload: unknown): VnWeatherWarningRow[] {
  const unwrapped = unwrapEnvelope(payload, 'items');
  if (!isRecord(unwrapped)) return [];
  const items = unwrapped.items;
  if (!Array.isArray(items)) return [];

  const rows: VnWeatherWarningRow[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const postId = typeof item.postId === 'number' && Number.isInteger(item.postId) && item.postId > 0
      ? item.postId
      : null;
    const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title : null;
    const url = typeof item.url === 'string' && item.url.startsWith('http') ? item.url : null;
    const kind = item.kind === 'warning' || item.kind === 'forecast' ? item.kind : null;
    if (postId === null || title === null || url === null || kind === null) continue;
    rows.push({ postId, title, url, kind });
  }

  // Hazard items lead; within each kind, newest post first.
  return rows.sort((a, b) => (a.kind === b.kind ? b.postId - a.postId : a.kind === 'warning' ? -1 : 1));
}
