#!/usr/bin/env node

// VN-region earthquakes — fork PR-3b. The authoritative domestic source
// (Viện Vật lý Địa cầu) is DNS-unreachable from this egress (checked
// 2026-10-25, see ZCODE-PR-3-SERIES.md), so the MVP reads the USGS FDSN
// API over the Vietnam bounding box. USGS carries contributed domestic
// events (typically M≥4 within minutes, M3 with delay) — a licensed/IGP
// feed remains the upgrade path and is noted in the manifest entry.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:earthquakes:v1';
// TTL must OUTLIVE the 30-minute staleness gate (seed-ttl fleet test).
const TTL = 3600;
// 5-minute cron: BUILD-PLAN's acceptance is "trận động đất trong nước xuất
// hiện ≤ 10 phút"; the USGS contribution lag dominates our side, so poll fast.
const VN_QUAKES_MAX_STALE_MIN = 30;

// Vietnam and immediate surroundings (includes Northern Laos / Gulf of
// Tonkin events felt in VN — matches how the domestic bulletin reports).
const USGS_QUERY_URL =
  'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=7&maxlatitude=24&minlongitude=100&maxlongitude=112&minmagnitude=3&orderby=time&limit=30';
// Kept as a plain quoted URL so the source-attribution scanner can discover
// the host (template literals with interpolation do not match its patterns).
const USGS_UA = 'RealtimeMonitor/1.0 (vn-earthquakes seeder)';

/** Days of history the board carries. */
const WINDOW_DAYS = 30;

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map the USGS FDSN GeoJSON onto the seeded board. Throws on structural
 * surprises (BUILD-PLAN §5.7); an empty feature list is a legitimate quiet
 * window, not a failure.
 */
export function parseUsgsQuakes(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('USGS response is empty');
  }
  let doc;
  try {
    doc = JSON.parse(payload);
  } catch (err) {
    throw new Error(`USGS response is not JSON: ${err.message}`);
  }
  if (doc?.metadata?.status !== 200) {
    throw new Error(`USGS FDSN answered status ${String(doc?.metadata?.status)}`);
  }
  if (!Array.isArray(doc?.features)) {
    throw new Error('USGS FDSN response has no features array');
  }

  const cutoffMs = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  const events = [];
  for (const feature of doc.features) {
    const p = feature?.properties;
    const coords = feature?.geometry?.coordinates;
    const id = typeof feature?.id === 'string' && feature.id !== '' ? feature.id : null;
    const magnitude = toNumber(p?.mag);
    const time = toNumber(p?.time);
    const latitude = Array.isArray(coords) ? toNumber(coords[1]) : null;
    const longitude = Array.isArray(coords) ? toNumber(coords[0]) : null;
    const depthKm = Array.isArray(coords) ? toNumber(coords[2]) : null;
    if (id === null || magnitude === null || time === null
      || latitude === null || longitude === null || depthKm === null) continue;
    if (time < cutoffMs) continue; // the API window and our window can drift
    events.push({
      id,
      magnitude,
      place: typeof p?.place === 'string' ? p.place : '',
      latitude,
      longitude,
      depthKm,
      time: new Date(time).toISOString(),
      url: typeof p?.url === 'string' ? p.url : null,
      tsunami: p?.tsunami === 1,
    });
  }

  // Newest first regardless of API ordering.
  events.sort((a, b) => (a.time < b.time ? 1 : -1));
  return { source: 'USGS-FDSN', events, seededAt: Date.now(), recordCount: events.length };
}

async function fetchVnEarthquakes() {
  const resp = await fetch(USGS_QUERY_URL, {
    headers: { Accept: 'application/json', 'User-Agent': USGS_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`USGS FDSN HTTP ${resp.status}`);

  const board = parseUsgsQuakes(await resp.text());
  console.log(`  VN earthquakes: ${board.events.length} events M≥3 in ${WINDOW_DAYS}d${board.events.length ? `, newest ${board.events[0].time}` : ''}`);
  return board;
}

export function validate(data) {
  const events = data?.events;
  if (!Array.isArray(events)) return false;
  const ids = new Set();
  for (const e of events) {
    if (!(e.magnitude >= 3 && e.magnitude <= 10)) return false;
    if (!(e.latitude >= 7 && e.latitude <= 24)) return false;
    if (!(e.longitude >= 100 && e.longitude <= 112)) return false;
    if (!(e.depthKm >= 0 && e.depthKm <= 700)) return false;
    if (typeof e.time !== 'string' || e.time === '') return false;
    if (e.id === '' || ids.has(e.id)) return false;
    ids.add(e.id);
  }
  // Sorted newest-first or the panel leads with old events.
  for (let i = 1; i < events.length; i += 1) {
    if (events[i - 1].time < events[i].time) return false;
  }
  return true;
}

export function declareRecords(data) {
  return Array.isArray(data?.events) ? data.events.length : 0;
}

// No content-age contract: a quiet month with no M≥3 event in the box is the
// region, not a source failure (seismicity is sporadic by nature). Seed
// liveness (STALE_SEED) covers real outages.

if (process.argv[1]?.endsWith('seed-vn-earthquakes.mjs')) {
  runSeed('vn', 'earthquakes', CANONICAL_KEY, fetchVnEarthquakes, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'usgs-fdsn-vn-bbox',
    recordCount: (data) => (Array.isArray(data?.events) ? data.events.length : 0),
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_QUAKES_MAX_STALE_MIN,
    zeroIsValid: true,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
