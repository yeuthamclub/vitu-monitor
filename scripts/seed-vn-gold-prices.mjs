#!/usr/bin/env node

// PNJ gold board — fork PR-2b. Primary source for VN gold prices: SJC's own
// service is Cloudflare-challenged for server-side fetches (observed
// 2026-10-24, see ZCODE-PR-2-SERIES.md), while PNJ's frontend edge API is open
// and carries the SJC bar price alongside PNJ's own ring/jewelry lines.
// Unofficial endpoint (frontend API, no published terms) — manifest status
// terms-review, and a licensed feed remains the commercialization path
// (BUILD-PLAN §5.10).
//
// Units: PNJ quotes per CHỈ (1 tael = 10 chỉ) in thousand-VND integers —
// giaban 14170 = 141,700,000 VNĐ per tael. The seeded row keeps the raw
// per-chỉ integers and the derived per-tael VND, direction named in every
// field (repo convention, cf. FxVnBankRateRow).

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { tokensToContentMeta, DAY_MIN } from './_content-age-helpers.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:gold-prices:v1';
// TTL must OUTLIVE the 30-minute staleness gate
// (tests/seed-ttl-outlives-staleness-fleet.test.mjs). 2× the gate.
const TTL = 3600;
const VN_GOLD_MAX_STALE_MIN = 30;
// PNJ republishes the board daily (including weekends, typically once);
// 4 days absorbs a holiday cluster plus missed crons without flagging a
// merely-quiet market as frozen content.
const VN_GOLD_MAX_CONTENT_AGE_MIN = 4 * DAY_MIN;

const PNJ_URL = 'https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00';
const PNJ_UA = 'RealtimeMonitor/1.0 (vn-gold seeder)';

/** "24/10/2026 09:38:51" (board time, UTC+07:00) → ISO with offset. */
function parsePnjUpdateDate(raw) {
  const m = String(raw ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6]}+07:00`;
}

/**
 * Parse the PNJ board into the seeded payload. Throws on any structural
 * surprise (BUILD-PLAN §5.7) instead of publishing a partial board.
 */
export function parsePnjGoldBoard(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('PNJ response is empty');
  }
  let doc;
  try {
    doc = JSON.parse(payload);
  } catch (err) {
    throw new Error(`PNJ response is not JSON: ${err.message}`);
  }

  const rows = doc?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('PNJ response missing data rows');
  }

  const asOf = parsePnjUpdateDate(doc?.updateDate);
  if (!asOf) {
    throw new Error(`PNJ updateDate not understood: ${String(doc?.updateDate)}`);
  }

  const products = {};
  let seen = 0;
  for (const row of rows) {
    const code = row?.masp;
    const name = row?.tensp;
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error(`PNJ row has no masp: ${JSON.stringify(row)}`);
    }
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`PNJ row ${code} has no tensp`);
    }
    // An empty string (or dash) is a legitimate not-currently-quoted leg —
    // the live board carries them (RAW_* lines outside trading, 2026-10-24) —
    // so it reads as null like the VCB dashed legs. Anything else that is not
    // an integer is a structural error.
    const parseLeg = (field, v) => {
      if (v === '' || v === null || v === '-') return null;
      if (!Number.isInteger(v)) {
        throw new Error(`PNJ row ${code} ${field} is not an integer: ${JSON.stringify(v)}`);
      }
      return v;
    };
    const buyRaw = parseLeg('giamua', row?.giamua);
    const sellRaw = parseLeg('giaban', row?.giaban);
    if (buyRaw === null && sellRaw === null) continue;
    // raw = nghìn VNĐ per CHỈ; 1 tael = 10 chỉ → VND per tael = raw × 10,000.
    products[code] = {
      name,
      buyPerChiRaw: buyRaw,
      sellPerChiRaw: sellRaw,
      buyVndPerTael: buyRaw === null ? null : buyRaw * 10_000,
      sellVndPerTael: sellRaw === null ? null : sellRaw * 10_000,
    };
    seen += 1;
  }

  return {
    store: 'PNJ',
    zone: '00',
    asOf,
    asOfDate: asOf.slice(0, 10),
    note: typeof doc?.note === 'string' ? doc.note : null,
    products,
    seededAt: Date.now(),
    recordCount: seen,
  };
}

async function fetchVnGoldPrices() {
  const resp = await fetch(PNJ_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': PNJ_UA,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    throw new Error(`PNJ API HTTP ${resp.status}`);
  }

  const board = parsePnjGoldBoard(await resp.text());
  console.log(`  VN gold prices: ${Object.keys(board.products).length} products as of ${board.asOf}`);
  return board;
}

export function validate(data) {
  const products = data?.products;
  if (!products || typeof products !== 'object') return false;
  const codes = Object.keys(products);
  // The live board carries ~20 lines; below 10 the board is truncated.
  if (codes.length < 10) return false;
  // SJC bar is the anchor the whole market prices against.
  const sjc = products.SJC;
  if (!sjc) return false;
  if (!(sjc.sellPerChiRaw >= 5_000 && sjc.sellPerChiRaw <= 100_000)) return false;
  if (!(sjc.buyPerChiRaw > 0 && sjc.buyPerChiRaw <= sjc.sellPerChiRaw)) return false;

  return codes.every((code) => {
    const p = products[code];
    const nums = [p?.buyPerChiRaw, p?.sellPerChiRaw].filter((v) => Number.isInteger(v));
    if (nums.length === 0) return false;
    // Floor 3,000: the 8K line buys at ~3,600 raw (2026-10-24) — a floor
    // at 5,000 would call the board's cheapest legitimate karat corrupt.
    if (!nums.every((v) => v >= 3_000 && v <= 100_000)) return false;
    if (Number.isInteger(p.buyPerChiRaw) && Number.isInteger(p.sellPerChiRaw)
      && p.buyPerChiRaw > p.sellPerChiRaw) return false;
    return typeof p?.name === 'string' && p.name !== '';
  });
}

export function declareRecords(data) {
  return Object.keys(data?.products ?? {}).length;
}

// Content-age contract: the board's own updateDate. PNJ republishes daily,
// so a frozen board trips STALE_CONTENT within ~4 days even while the seeder
// itself keeps succeeding.
export function vnGoldContentMeta(data) {
  return tokensToContentMeta([data?.asOfDate].filter(Boolean));
}

if (process.argv[1]?.endsWith('seed-vn-gold-prices.mjs')) {
  runSeed('vn', 'gold-prices', CANONICAL_KEY, fetchVnGoldPrices, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'pnj-edge-api',
    recordCount: (data) => Object.keys(data?.products ?? {}).length,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_GOLD_MAX_STALE_MIN,
    contentMeta: vnGoldContentMeta,
    maxContentAgeMin: VN_GOLD_MAX_CONTENT_AGE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
