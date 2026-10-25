#!/usr/bin/env node

// VPS board quotes — fork PR-2c. Unofficial frontend endpoint of the VPS
// securities board (no published terms — manifest terms-review; licensed feed
// remains the commercialization path per BUILD-PLAN §5.10).
//
// The basket is the HOSE blue-chip cohort (a superset view of VN30, whose
// membership rotates twice a year): seeding a fixed 30-ticker list keeps the
// URL bounded and the payload stable, and validate() tolerates a few rows the
// board does not return (delistings, ticker renames) before failing loud.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:stock-quotes:v1';
const TTL = 3600; // must outlive the 15-minute staleness gate
const VN_QUOTES_MAX_STALE_MIN = 15;

const VPS_UA = 'RealtimeMonitor/1.0 (vn-stock-quotes seeder)';

// HOSE blue-chip cohort, ~VN30 superset (reviewed at PR-2c, 2026-10).
export const BLUE_CHIP_TICKERS = Object.freeze([
  'ACB', 'BID', 'BMP', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG', 'LPB',
  'MB', 'MSN', 'MWG', 'PLX', 'POW', 'REE', 'SAB', 'SHB', 'SSB', 'STB',
  'TCB', 'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VRE',
]);

/** VPS carries some numbers as strings ("0.86"); numbers as numbers. */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Map one VPS board row onto the seeded quote. Returns null for a row the
 * board returned with no tradeable quote; throws only on shapes that mean
 * the endpoint changed (BUILD-PLAN §5.7).
 */
export function parseVpsQuote(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.sym !== 'string' || row.sym === '') {
    throw new Error(`VPS row has no sym: ${JSON.stringify(row).slice(0, 120)}`);
  }
  const last = toNumber(row.lastPrice);
  const ref = toNumber(row.r);
  const ceiling = toNumber(row.c);
  const floor = toNumber(row.f);
  // Outside trading the board still carries the last close, so an absent
  // last price is an unquoted row, not a failure — skip it.
  if (last === null || last <= 0) return null;
  return {
    symbol: row.sym,
    last,
    ref: ref !== null && ref > 0 ? ref : null,
    ceiling: ceiling !== null && ceiling > 0 ? ceiling : null,
    floor: floor !== null && floor > 0 ? floor : null,
    changePct: (() => {
      const pct = toNumber(row.changePc);
      if (pct !== null) return pct;
      if (ref !== null && ref > 0) return +(((last - ref) / ref) * 100).toFixed(2);
      return null;
    })(),
    high: (() => { const h = toNumber(row.highPrice); return h !== null && h > 0 ? h : null; })(),
    low: (() => { const l = toNumber(row.lowPrice); return l !== null && l > 0 ? l : null; })(),
    // Matched volume in shares this session.
    volume: (() => { const v = toNumber(row.lot); return v !== null && v >= 0 ? v : null; })(),
  };
}

async function fetchVnStockQuotes() {
  const resp = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${BLUE_CHIP_TICKERS.join(',')}`, {
    headers: { Accept: 'application/json', 'User-Agent': VPS_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`VPS board HTTP ${resp.status}`);
  const rows = await resp.json();
  if (!Array.isArray(rows)) {
    throw new Error('VPS board did not return a row array');
  }

  const quotes = {};
  for (const row of rows) {
    const quote = parseVpsQuote(row);
    if (quote) quotes[quote.symbol] = quote;
  }
  console.log(`  VN stock quotes: ${Object.keys(quotes).length}/${BLUE_CHIP_TICKERS.length} tickers quoted`);
  return { quotes, seededAt: Date.now() };
}

export function validate(data) {
  const quotes = data?.quotes;
  if (!quotes || typeof quotes !== 'object') return false;
  const symbols = Object.keys(quotes);
  // Below ~20 the board is truncated, not thin — the cohort is 30.
  if (symbols.length < 20) return false;
  return symbols.every((symbol) => {
    const q = quotes[symbol];
    if (!(q.last > 0 && q.last < 1_000_000)) return false;
    // Floor ≤ last ≤ ceiling when the band is present.
    if (q.floor !== null && q.last < q.floor - 0.05) return false;
    if (q.ceiling !== null && q.last > q.ceiling + 0.05) return false;
    if (q.ref !== null && q.floor !== null && q.ceiling !== null && !(q.floor <= q.ref && q.ref <= q.ceiling)) return false;
    if (q.changePct !== null && !(Math.abs(q.changePct) <= 30)) return false; // VN price bands are ±7%/±10%/±15%
    if (q.high !== null && q.low !== null && q.high < q.low) return false;
    return typeof q.symbol === 'string' && q.symbol !== '';
  });
}

export function declareRecords(data) {
  return Object.keys(data?.quotes ?? {}).length;
}

if (process.argv[1]?.endsWith('seed-vn-stock-quotes.mjs')) {
  runSeed('vn', 'stock-quotes', CANONICAL_KEY, fetchVnStockQuotes, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'vps-board-api',
    recordCount: (data) => Object.keys(data?.quotes ?? {}).length,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_QUOTES_MAX_STALE_MIN,
    // No content-age contract: the board freezes at the close and republishes
    // the same close outside trading, so a frozen board is a session boundary,
    // not a source failure. Seed liveness (STALE_SEED) covers real outages.
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
