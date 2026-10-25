#!/usr/bin/env node

// SSI iBoard index quotes — fork PR-2c. Unofficial frontend endpoint of the
// SSI board (no published terms — manifest terms-review; a licensed feed
// remains the commercialization path per BUILD-PLAN §5.10).
//
// The seeder fetches the three headline VN indices per run: VNINDEX (HOSE),
// VN30 (large-cap basket) and HNXIndex (Hanoi). `time` is epoch ms on the
// board's clock, so the content-age contract can detect a frozen board even
// while the seeder keeps succeeding.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { tokensToContentMeta } from './_content-age-helpers.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:stock-indices:v1';
// TTL must OUTLIVE the 15-minute staleness gate (seed-ttl fleet test).
const TTL = 3600;
// 5-minute cron (in-session cadence per BUILD-PLAN), maxStale 3× the cycle.
const VN_STOCK_MAX_STALE_MIN = 15;
// The board freezes at the close and republishes the same close all weekend,
// so the content-age budget spans a weekend plus a holiday cluster.
const VN_STOCK_MAX_CONTENT_AGE_MIN = 4 * 24 * 60;

const SSI_UA = 'RealtimeMonitor/1.0 (vn-stock-indices seeder)';

const INDEX_IDS = ['VNINDEX', 'VN30', 'HNXINDEX'];

async function fetchIndex(indexId) {
  const resp = await fetch(`https://iboard-query.ssi.com.vn/exchange-index/${indexId}?hasHistory=false`, {
    headers: { Accept: 'application/json', 'User-Agent': SSI_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`SSI iBoard HTTP ${resp.status} for ${indexId}`);
  const body = await resp.json();
  if (body?.code !== 'SUCCESS') {
    throw new Error(`SSI iBoard ${indexId} answered ${String(body?.code)}: ${String(body?.message)}`);
  }
  return body.data;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one iBoard index payload into the seeded row. Throws on structural
 * surprises (BUILD-PLAN §5.7) instead of publishing a partial index.
 */
export function parseSsiIndex(indexId, data) {
  if (!data || typeof data !== 'object') {
    throw new Error(`SSI iBoard ${indexId} has no data object`);
  }
  const value = toNumber(data.indexValue);
  const prevValue = toNumber(data.prevIndexValue);
  const time = toNumber(data.time);
  if (value === null || value <= 0) {
    throw new Error(`SSI iBoard ${indexId} has no indexValue: ${JSON.stringify(data.indexValue)}`);
  }
  if (prevValue === null || prevValue <= 0) {
    throw new Error(`SSI iBoard ${indexId} has no prevIndexValue`);
  }
  if (time === null || time <= 0) {
    throw new Error(`SSI iBoard ${indexId} has no time`);
  }
  const change = toNumber(data.change);
  return {
    value,
    prevValue,
    // The board carries the absolute change; the percentage is derived, not
    // trusted from any field it may or may not carry.
    change: change === null ? value - prevValue : change,
    changePct: +(((value - prevValue) / prevValue) * 100).toFixed(2),
    time: new Date(time).toISOString(),
    exchange: typeof data.exchange === 'string' ? data.exchange : null,
    advances: toNumber(data.advances),
    declines: toNumber(data.declines),
    // Total matched value, VND — the session's turnover.
    allValue: toNumber(data.allValue),
  };
}

async function fetchVnStockIndices() {
  const indices = {};
  for (const indexId of INDEX_IDS) {
    indices[indexId] = parseSsiIndex(indexId, await fetchIndex(indexId));
  }
  const asOf = indices.VNINDEX.time;
  console.log(`  VN stock indices: ${Object.keys(indices).length} indices, VNINDEX ${indices.VNINDEX.value} as of ${asOf}`);
  return { indices, asOf, seededAt: Date.now() };
}

export function validate(data) {
  const indices = data?.indices;
  if (!indices || typeof indices !== 'object') return false;
  for (const indexId of INDEX_IDS) {
    const idx = indices[indexId];
    if (!idx) return false;
    // VN30 ~1900, VNINDEX ~1700-1800, HNXIndex ~260: a 50..100,000 band covers
    // every plausible level while rejecting a scraped garbage number.
    if (!(idx.value >= 50 && idx.value <= 100_000)) return false;
    if (!(idx.prevValue > 0)) return false;
    if (!(Math.abs(idx.value - idx.prevValue) < idx.prevValue)) return false; // >±100% in a day is corruption
    if (typeof idx.time !== 'string' || idx.time === '') return false;
  }
  return true;
}

export function declareRecords(data) {
  return Object.keys(data?.indices ?? {}).length;
}

export function vnStockContentMeta(data, nowMs = Date.now()) {
  const tokens = Object.values(data?.indices ?? {})
    .map((idx) => idx?.time)
    .filter((t) => typeof t === 'string' && t !== '');
  return tokens.length ? tokensToContentMeta(tokens, nowMs) : null;
}

if (process.argv[1]?.endsWith('seed-vn-stock-indices.mjs')) {
  runSeed('vn', 'stock-indices', CANONICAL_KEY, fetchVnStockIndices, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'ssi-iboard',
    recordCount: (data) => Object.keys(data?.indices ?? {}).length,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_STOCK_MAX_STALE_MIN,
    contentMeta: vnStockContentMeta,
    maxContentAgeMin: VN_STOCK_MAX_CONTENT_AGE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
