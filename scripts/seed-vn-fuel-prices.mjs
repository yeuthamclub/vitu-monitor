#!/usr/bin/env node

// Petrolimex retail fuel board — fork PR-2d.
//
// The public HTML price page is gone (redirects home since ~2026-10-24) and
// the site now fills its price widget from the CMS API behind it. This seeder
// replicates that widget's own request exactly: an anonymous GET whose
// `x-request` is just base64url(JSON) — no session, no crypto (verified
// 2026-10-25; see ZCODE-PR-2D-FINDINGS.md for how the source was located).
// The CMS ids below are the widget's own constants; if Petrolimex re-points
// the widget, these fail loud rather than publishing an empty board.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:fuel-prices:v1';
// Retail prices only move at adjustment cycles (roughly fortnightly, longer
// when the stabilization fund absorbs shocks), so the seed lives long: the
// TTL must OUTLIVE the 8-day staleness gate (BUILD-PLAN §4 "ngưỡng cũ 8 ngày",
// seed-ttl fleet test) — 10 days bridges a missed weekly cron plus a cycle.
const TTL = 10 * 24 * 3600;
const VN_FUEL_MAX_STALE_MIN = 8 * 24 * 60;

const PLX_UA = 'RealtimeMonitor/1.0 (vn-fuel seeder)';

// Kept as a plain quoted URL so the source-attribution scanner can discover
// the host (template literals with interpolation do not match its patterns).
const PLX_API_BASE = 'https://portals.petrolimex.com.vn/~apis/portals/cms.item/search';

// The price widget's own CMS filter (plx.1.prices.min.js, 2026-10-25).
const CMS_SYSTEM_ID = '6783dc1271ff449e95b74a9520964169';
const CMS_REPOSITORY_ID = 'a95451e23b474fe5886bfb7cf843f53c';
const CMS_REPOSITORY_ENTITY_ID = '3801378fe1e045b1afa10de7c5776124';

function base64Url(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function buildPricesUrl() {
  const request = {
    FilterBy: { And: [
      { SystemID: { Equals: CMS_SYSTEM_ID } },
      { RepositoryID: { Equals: CMS_REPOSITORY_ID } },
      { RepositoryEntityID: { Equals: CMS_REPOSITORY_ENTITY_ID } },
      { Status: { Equals: 'Published' } },
    ] },
    SortBy: { LastModified: 'Descending' },
    Pagination: { TotalRecords: -1, TotalPages: 0, PageSize: 0, PageNumber: 0 },
  };
  const qs = new URLSearchParams({
    'x-request': base64Url(JSON.stringify(request)),
    // The framework requires these device/app params even for anonymous calls;
    // values mirror what the site's own widget sends.
    'x-device-id': 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'x-app-name': base64Url('NGX Websites'),
    'x-app-platform': base64Url('Desktop PWA'),
    language: 'vi-VN',
  });
  return `${PLX_API_BASE}/~apis/portals/cms.item/search?${qs}`;
}

function toNumber(value) {
  // Number(null) === 0 — an absent zone price must stay null, not read as a
  // free liter.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map the CMS response onto the seeded board. Throws on structural surprises
 * (BUILD-PLAN §5.7) instead of publishing a partial board.
 */
export function parsePlxFuelBoard(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('Petrolimex response is empty');
  }
  let doc;
  try {
    doc = JSON.parse(payload);
  } catch (err) {
    throw new Error(`Petrolimex response is not JSON: ${err.message}`);
  }
  const objects = doc?.Objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new Error('Petrolimex response has no Objects');
  }

  const products = {};
  let lastModified = '';
  for (const item of objects) {
    const title = item?.Title;
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error(`Petrolimex item has no Title: ${JSON.stringify(item).slice(0, 120)}`);
    }
    const zone1 = toNumber(item?.Zone1Price);
    const zone2 = toNumber(item?.Zone2Price);
    if (zone1 === null || zone2 === null) {
      throw new Error(`Petrolimex item ${title} has no zone price`);
    }
    const mod = typeof item?.LastModified === 'string' ? item.LastModified : '';
    if (mod > lastModified) lastModified = mod;
    products[title] = { zone1VndPerLiter: zone1, zone2VndPerLiter: zone2, lastModified: mod || null };
  }

  return {
    retailer: 'Petrolimex',
    asOf: lastModified || null,
    products,
    seededAt: Date.now(),
    recordCount: Object.keys(products).length,
  };
}

async function fetchVnFuelPrices() {
  const resp = await fetch(buildPricesUrl(), {
    headers: { Accept: 'application/json', 'User-Agent': PLX_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`Petrolimex API HTTP ${resp.status}`);

  const board = parsePlxFuelBoard(await resp.text());
  console.log(`  VN fuel prices: ${Object.keys(board.products).length} products, board as of ${board.asOf}`);
  return board;
}

export function validate(data) {
  const products = data?.products;
  if (!products || typeof products !== 'object') return false;
  const titles = Object.keys(products);
  // The board carries ~6 products (E10 RON95-V/III, E5 RON92, DO ×2, kerosene).
  if (titles.length < 5) return false;
  // E5 RON 92 is the mandatory nationwide baseline grade.
  const hasBaseline = titles.some((t) => /E5\s*RON\s*92/i.test(t));
  if (!hasBaseline) return false;

  return titles.every((title) => {
    const p = products[title];
    // VND per liter: 10k–60k covers every adjustment cycle seen; far beyond
    // either bound is page-wide corruption.
    return Number.isFinite(p?.zone1VndPerLiter) && p.zone1VndPerLiter >= 10_000 && p.zone1VndPerLiter <= 60_000
      && Number.isFinite(p?.zone2VndPerLiter) && p.zone2VndPerLiter >= 10_000 && p.zone2VndPerLiter <= 60_000
      && p.zone2VndPerLiter >= p.zone1VndPerLiter; // Zone 2 costs more to serve
  });
}

export function declareRecords(data) {
  return Object.keys(data?.products ?? {}).length;
}

// No content-age contract: prices legitimately freeze between adjustment
// cycles (and longer when the stabilization fund holds them), so an unchanged
// board is a policy state, not a source failure. Seed liveness covers outages.

if (process.argv[1]?.endsWith('seed-vn-fuel-prices.mjs')) {
  runSeed('vn', 'fuel-prices', CANONICAL_KEY, fetchVnFuelPrices, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'petrolimex-cms-api',
    recordCount: (data) => Object.keys(data?.products ?? {}).length,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_FUEL_MAX_STALE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
