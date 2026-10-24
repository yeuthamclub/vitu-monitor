#!/usr/bin/env node

// Vietcombank publishes its reference exchange board as a hand-rolled XML
// file whose own header states the access contract: "For reference only.
// Only one request every 5 minutes!" The 10-minute cron plus runSeed's lock
// keep us under that limit; never shorten the cron below 5 minutes.
//
// Quote direction: every Exrate attribute is VND per 1 unit of the foreign
// currency. Buy = the bank pays you (lower), Sell = the bank charges you
// (higher), Transfer sits between them (no cash handling). The row type in
// src/services/economic/fx-rates.ts names the direction in every field.

import { XMLParser } from 'fast-xml-parser';
import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { tokensToContentMeta, DAY_MIN } from './_content-age-helpers.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:fx-rates:v1';
// The Redis TTL must OUTLIVE the 30-minute staleness gate
// (tests/seed-ttl-outlives-staleness-fleet.test.mjs), or a merely-late seeder
// reads as an EMPTY crit before health can call it stale. 2× the gate bridges
// five missed 10-minute runs.
const TTL = 3600;
// Staleness budget per BUILD-PLAN §5.8: maxStale ≈ 2–3× the collection cycle
// (10 min → 30 min). Past that, /api/health reports the source stale and the
// panel shows a source-error state instead of numbers.
const VN_FX_MAX_STALE_MIN = 30;
// The board is a weekday snapshot (VCB does not republish over the weekend),
// the same freeze-risk shape as the ECB daily series: a 10-day content-age
// budget absorbs a weekend + holiday cluster + one missed cron.
const VN_FX_MAX_CONTENT_AGE_MIN = 10 * DAY_MIN;

const VCB_URL = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx';
// Named project UA per the fork collection rules (BUILD-PLAN §5.6). VCB has
// no published API terms for this file beyond the in-band 5-minute limit.
const VCB_UA = 'RealtimeMonitor/1.0 (vn-fx-rates seeder)';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

/** "10/24/2026 7:03:04 PM" (board time, UTC+07:00) → ISO with offset. */
function parseVcbDateTime(raw) {
  const m = String(raw ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hour = parseInt(m[4], 10);
  const minute = m[5];
  const second = m[6];
  const meridiem = m[7]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(hour)}:${minute}:${second}+07:00`;
}

/** VCB prints VND amounts with thousands commas ("26,330"), but not every row
 * carries them — small board values (DKK ~3,700) arrive as bare integers, and
 * pairs the bank does not trade for cash carry a bare dash ("Buy=\"-\"").
 * A dash is a legitimate missing quote, returned as null; anything else that
 * does not look like an amount is a structural error. */
function parseVndAmount(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '-') return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(text)) {
    throw new Error(`VCB amount not understood: ${JSON.stringify(raw)}`);
  }
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse the XML board into the seeded payload. Throws on any structural
 * surprise so a layout change fails loud (BUILD-PLAN §5.7) instead of
 * publishing a partial board.
 */
export function parseVcbFxBoard(xmlText) {
  if (typeof xmlText !== 'string' || xmlText.length === 0) {
    throw new Error('VCB response is empty');
  }
  let doc;
  try {
    doc = xmlParser.parse(xmlText);
  } catch (err) {
    throw new Error(`VCB XML is not parseable: ${err.message}`);
  }

  const list = doc?.ExrateList;
  if (!list || typeof list !== 'object') {
    throw new Error('VCB XML missing ExrateList root');
  }

  const asOf = parseVcbDateTime(list?.DateTime);
  if (!asOf) {
    throw new Error(`VCB XML DateTime not understood: ${String(list?.DateTime)}`);
  }

  // fast-xml-parser collapses a single repeated child into a bare object, so
  // wrap it back into the many-row shape every consumer below assumes.
  const rawRows = list?.Exrate;
  const rows = Array.isArray(rawRows)
    ? rawRows
    : rawRows && typeof rawRows === 'object' ? [rawRows] : null;
  if (!rows || rows.length === 0) {
    throw new Error('VCB XML has no Exrate rows');
  }

  const rates = {};
  let seenCurrencies = 0;
  for (const row of rows) {
    const currency = row?.['@_CurrencyCode'];
    const buy = parseVndAmount(row?.['@_Buy'] ?? '');
    const transfer = parseVndAmount(row?.['@_Transfer'] ?? '');
    const sell = parseVndAmount(row?.['@_Sell'] ?? '');
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`VCB row has malformed CurrencyCode: ${String(currency)}`);
    }
    // A dash on one leg is a legitimate missing quote (the bank does not trade
    // that pair for cash); a row with no numeric quote at all is not a board.
    if (buy === null && transfer === null && sell === null) {
      throw new Error(`VCB row ${currency} has no numeric amount`);
    }
    rates[currency] = { buy, transfer, sell };
    seenCurrencies += 1;
  }

  return {
    bank: 'Vietcombank',
    asOf,
    // Board date only (no time) — the content-age freeze detector works on
    // day granularity because VCB does not republish daily.
    asOfDate: asOf.slice(0, 10),
    rates,
    seededAt: Date.now(),
    recordCount: seenCurrencies,
  };
}

async function fetchVnFxRates() {
  const resp = await fetch(VCB_URL, {
    headers: {
      Accept: 'application/xml, text/xml',
      'User-Agent': VCB_UA,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    throw new Error(`Vietcombank API HTTP ${resp.status}`);
  }

  const board = parseVcbFxBoard(await resp.text());
  console.log(`  VN FX rates: ${Object.keys(board.rates).length} currencies as of ${board.asOf}`);
  return board;
}

export function validate(data) {
  const rates = data?.rates;
  if (!rates || typeof rates !== 'object') return false;
  const currencies = Object.keys(rates);
  if (currencies.length < 15) return false;

  const usd = rates.USD;
  if (!usd) return false;
  // Anchors on the dollar pair: ~26k VND today, orders of magnitude away from
  // either bound, so a scraped page-wide corruption trips here.
  if (!(typeof usd.sell === 'number' && usd.sell >= 10_000 && usd.sell <= 100_000)) return false;
  if (typeof usd.buy === 'number' && !(usd.buy > 0 && usd.buy <= usd.sell)) return false;

  return currencies.every((code) => {
    const r = rates[code];
    // Dash legs (null) skip their checks; every row keeps at least one quote.
    const nums = [r?.buy, r?.transfer, r?.sell].filter((v) => typeof v === 'number');
    if (nums.length === 0) return false;
    if (!nums.every((v) => v > 0 && v < 1_000_000)) return false;
    if (typeof r.buy === 'number' && typeof r.transfer === 'number' && r.buy > r.transfer) return false;
    if (typeof r.transfer === 'number' && typeof r.sell === 'number' && r.transfer > r.sell) return false;
    return true;
  });
}

export function declareRecords(data) {
  return Object.keys(data?.rates ?? {}).length;
}

// Content-age contract: the board's own DateTime. Detects an upstream freeze
// (HTTP 200 with a republished old board) that seeder-liveness cannot.
export function vnFxContentMeta(data) {
  return tokensToContentMeta([data?.asOfDate].filter(Boolean));
}

if (process.argv[1]?.endsWith('seed-vn-fx-rates.mjs')) {
  runSeed('vn', 'fx-rates', CANONICAL_KEY, fetchVnFxRates, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'vietcombank-portal-xml',
    recordCount: (data) => Object.keys(data?.rates ?? {}).length,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_FX_MAX_STALE_MIN,
    contentMeta: vnFxContentMeta,
    maxContentAgeMin: VN_FX_MAX_CONTENT_AGE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
