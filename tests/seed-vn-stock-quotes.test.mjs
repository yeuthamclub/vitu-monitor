// VPS board quote seeder — fork PR-2c. Same fail-loud contract; validate()
// requires a substantial fraction of the 30-ticker cohort so a truncated
// board cannot publish, while tolerating a few unquoted rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLUE_CHIP_TICKERS,
  declareRecords,
  parseVpsQuote,
  validate,
} from '../scripts/seed-vn-stock-quotes.mjs';

// Trimmed from the live board (2026-10-24). Numbers as numbers or strings.
function vpsRow(overrides = {}) {
  return {
    id: 2100, boardId: 'G1', marketId: 'STO', sequence: 112201,
    channel: null, sourceMsgType: 'MT', hashValue: 'VNM',
    transId: 'MT:112201:VN000000VNM8', tradingSession: null,
    c: 62.1, f: 54.1, r: 58.1, sym: 'VNM', symCode: 'VN000000VNM8',
    mc: '10', lastPrice: 57.6, lastVolume: 10, lot: 179370,
    ot: '0.50', changePc: '0.86', avePrice: '57.76',
    highPrice: '58.1', lowPrice: '57.5',
    ...overrides,
  };
}

test('parses the live board shape, numbers and strings alike', () => {
  const quote = parseVpsQuote(vpsRow());
  assert.equal(quote.symbol, 'VNM');
  assert.equal(quote.last, 57.6);
  assert.equal(quote.ref, 58.1);
  assert.equal(quote.ceiling, 62.1);
  assert.equal(quote.floor, 54.1);
  assert.equal(quote.changePct, 0.86);
  assert.equal(quote.high, 58.1);   // string → number
  assert.equal(quote.low, 57.5);
  assert.equal(quote.volume, 179370);
});

test('an unquoted row is skipped, not a failure', () => {
  assert.equal(parseVpsQuote(vpsRow({ lastPrice: 0 })), null);
  assert.equal(parseVpsQuote(vpsRow({ lastPrice: '' })), null);
  assert.equal(parseVpsQuote(null), null);
  // changePct missing falls back to (last − ref) / ref.
  const q = parseVpsQuote(vpsRow({ changePc: undefined }));
  assert.equal(q.changePct, +(((57.6 - 58.1) / 58.1) * 100).toFixed(2));
  // A row without a symbol means the endpoint changed.
  assert.throws(() => parseVpsQuote(vpsRow({ sym: '' })), /no sym/);
});

function payloadWith(rowOverridesPerSymbol = {}, extraSymbols = []) {
  const quotes = {};
  const tickers = [...BLUE_CHIP_TICKERS, ...extraSymbols];
  for (const sym of tickers) {
    const o = rowOverridesPerSymbol[sym] ?? {};
    quotes[sym] = parseVpsQuote(vpsRow({ sym, hashValue: sym, ...o }));
  }
  // Strip nulls the way the seeder's fetch loop does.
  for (const k of Object.keys(quotes)) if (quotes[k] === null) delete quotes[k];
  return { quotes, seededAt: Date.now() };
}

test('validate tolerates a few unquoted rows but not a truncated board', () => {
  assert.equal(validate(payloadWith()), true); // all 30 quoted
  // 5 unquoted → 25 remain → still publishable.
  const fewMissing = payloadWith(Object.fromEntries(
    ['SAB', 'SHB', 'SSB', 'BMP', 'PLX'].map((s) => [s, { lastPrice: 0 }]),
  ));
  assert.equal(validate(fewMissing), true);
  assert.equal(declareRecords(fewMissing), 25);
  // Below 20 → truncated, fail loud.
  const truncated = payloadWith(Object.fromEntries(
    BLUE_CHIP_TICKERS.slice(0, 11).map((s) => [s, { lastPrice: 0 }]),
  ));
  assert.equal(validate(truncated), false);
});

test('validate catches per-row corruption', () => {
  assert.equal(validate(payloadWith({ VNM: { lastPrice: 999_999 } })), false);
  assert.equal(validate(payloadWith({ VNM: { lastPrice: 70 } })), false);  // above ceiling 62.1
  assert.equal(validate(payloadWith({ VNM: { lastPrice: 50 } })), false);  // below floor 54.1
  assert.equal(validate(payloadWith({ VNM: { changePc: '40' } })), false); // beyond any VN band
  assert.equal(validate(payloadWith({ VNM: { highPrice: '50', lowPrice: '60' } })), false); // inverted range
  assert.equal(validate(undefined), false);
});
