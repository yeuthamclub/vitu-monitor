#!/usr/bin/env node

// NCHMF weather warnings — fork PR-3a. The fork's first true HTML scrape
// (Petrolimex turned out to be an API). The national hydrometeorology
// service publishes its live warning/forecast bulletins as "post" links on
// the homepage; the ascending post ids double as the recency ordering and
// the dedupe key, so the list page alone is enough for the panel (bulletin
// titles carry the severity vocabulary: "TIN CẢNH BÁO…", "TIN DỰ BÁO…").
//
// Collection rules (BUILD-PLAN §5.7): the extraction is pinned to the
// homepage's link shape — any layout change that yields fewer than the
// minimum fails loud instead of publishing an empty board.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:weather-warnings:v1';
// TTL must OUTLIVE the 60-minute staleness gate (seed-ttl fleet test).
const TTL = 7200;
// 30-minute cron per BUILD-PLAN §4 ("15–30 phút; dày hơn khi có bão"),
// maxStale 2× the cycle.
const VN_WEATHER_MAX_STALE_MIN = 60;

const NCHMF_URL = 'https://www.nchmf.gov.vn/';
// Kept as a plain quoted URL so the source-attribution scanner can discover
// the host (template literals with interpolation do not match its patterns).
const NCHMF_UA = 'RealtimeMonitor/1.0 (vn-weather-warnings seeder)';

// The board publishes dozens of routine hydrology bulletins per day; the
// panel leads with hazard items, so classify by the title vocabulary the
// service itself uses (checked in caps-insensitive Vietnamese).
const WARNING_TITLE_RE = /(cảnh báo|thông báo|bão|áp thấp|lũ|ngập|sạt lở|sụt lún|dông|tố|lốc|vòi rồng|nắng nóng|không khí lạnh|triều cường|rét đậm|rét hại|sương muối|gió giật|mưa đá)/i;

const MIN_BULLETINS = 5;
const MAX_BULLETINS = 40;

/**
 * Extract the bulletin board from the homepage HTML. Throws on structural
 * surprises (BUILD-PLAN §5.7) instead of publishing a partial board.
 */
export function parseNchmfBoard(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('NCHMF response is empty');
  }
  // The scrape anchor: the hydromet bulletin listing area. Its absence means
  // the layout changed and every extracted link below would be garbage.
  if (!html.includes('/kttv/')) {
    throw new Error('NCHMF page has no /kttv/ bulletin links — layout changed');
  }

  const seen = new Map(); // postId → item, first (highest) occurrence wins
  const pattern = /href="([^"]*\/kttv\/[^"]*?post(\d+)\.html)"[^>]*>\s*([^<]{15,200}?)\s*</g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [, href, idText, rawTitle] = match;
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    if (title === '') continue;
    const postId = Number(idText);
    if (!Number.isInteger(postId) || postId <= 0) continue;
    if (!seen.has(postId)) {
      seen.set(postId, {
        postId,
        title,
        url: href.startsWith('http') ? href : `https://www.nchmf.gov.vn${href}`,
        kind: WARNING_TITLE_RE.test(title) ? 'warning' : 'forecast',
      });
    }
  }

  const items = [...seen.values()];
  if (items.length < MIN_BULLETINS) {
    throw new Error(`NCHMF page yielded only ${items.length} bulletins (min ${MIN_BULLETINS}) — layout changed`);
  }

  // Highest post id first — the service's ids are monotone with publication.
  items.sort((a, b) => b.postId - a.postId);
  return {
    source: 'NCHMF',
    items: items.slice(0, MAX_BULLETINS),
    seededAt: Date.now(),
    recordCount: Math.min(items.length, MAX_BULLETINS),
  };
}

async function fetchVnWeatherWarnings() {
  const resp = await fetch(NCHMF_URL, {
    headers: { Accept: 'text/html', 'User-Agent': NCHMF_UA },
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) throw new Error(`NCHMF HTTP ${resp.status}`);

  const board = parseNchmfBoard(await resp.text());
  const warnings = board.items.filter((i) => i.kind === 'warning').length;
  console.log(`  VN weather warnings: ${board.items.length} bulletins (${warnings} hazard-titled), newest post ${board.items[0].postId}`);
  return board;
}

export function validate(data) {
  const items = data?.items;
  if (!Array.isArray(items) || items.length < MIN_BULLETINS) return false;
  const postIds = new Set();
  for (const item of items) {
    if (!Number.isInteger(item?.postId) || item.postId <= 0) return false;
    if (postIds.has(item.postId)) return false; // duplicates break ordering
    postIds.add(item.postId);
    if (typeof item.title !== 'string' || item.title.length < 10) return false;
    if (typeof item.url !== 'string' || !item.url.includes('nchmf.gov.vn')) return false;
    if (item.kind !== 'warning' && item.kind !== 'forecast') return false;
  }
  // Sorted newest-first, or the panel leads with stale items.
  for (let i = 1; i < items.length; i += 1) {
    if (items[i - 1].postId <= items[i].postId) return false;
  }
  return true;
}

export function declareRecords(data) {
  return Array.isArray(data?.items) ? data.items.length : 0;
}

// No content-age contract: in calm weather the newest bulletin can be hours
// old by nature (no hazard to warn about), so board age is weather, not
// source health. Seed liveness (STALE_SEED) covers real outages.

if (process.argv[1]?.endsWith('seed-vn-weather-warnings.mjs')) {
  runSeed('vn', 'weather-warnings', CANONICAL_KEY, fetchVnWeatherWarnings, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'nchmf-homepage-board',
    recordCount: (data) => (Array.isArray(data?.items) ? data.items.length : 0),
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_WEATHER_MAX_STALE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
