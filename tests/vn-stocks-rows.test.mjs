// VN Stocks panel row mappers — fork PR-2c. Pins the envelope tolerance and
// the drop-don't-half-render rule for both payloads.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  degradedVnStocksSources,
  toVnStockIndexRows,
  toVnStockQuoteRows,
} from '../src/services/economic/vn-stocks.ts';

// ─── vn:stock-indices:v1 ────────────────────────────────────────────────────────

function indicesPayload(indices) {
  return { indices, asOf: '2026-10-24T09:25:05.082Z', seededAt: Date.now() };
}

test('maps indices in headline order and derives the percentage', () => {
  const mk = (value, prev) => ({ value, prevValue: prev, change: value - prev, changePct: null, time: '2026-10-24T09:25:05.082Z', exchange: 'hose', advances: 10, declines: 5, allValue: 1 });
  const rows = toVnStockIndexRows(indicesPayload({
    HNXINDEX: mk(262.7, 261.08),
    VN30: mk(1907.09, 1892.98),
    VNINDEX: mk(1774.15, 1760.63),
  }));
  assert.deepEqual(rows.map((r) => r.indexId), ['VNINDEX', 'VN30', 'HNXINDEX']);
  const vnindex = rows[0];
  assert.equal(vnindex.changePct, 0.77);
  assert.equal(vnindex.exchange, 'hose');
});

test('drops malformed index entries and rejects unusable payloads', () => {
  const rows = toVnStockIndexRows(indicesPayload({
    VNINDEX: { value: 1774.15, prevValue: 1760.63, change: 13.52 },
    VN30: { value: 0, prevValue: 1892.98 },     // zero level
    HNXINDEX: null,                              // absent
  }));
  assert.deepEqual(rows.map((r) => r.indexId), ['VNINDEX']);
  const payload = indicesPayload({ VNINDEX: { value: 1774.15, prevValue: 1760.63, change: 1 } });
  assert.equal(toVnStockIndexRows({ _seed: {}, data: payload }).length, 1);
  for (const bad of [undefined, null, {}, { indices: [] }, { indices: null }, [], 'x', 42]) {
    assert.deepEqual(toVnStockIndexRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

// ─── vn:stock-quotes:v1 ─────────────────────────────────────────────────────────

function quotesPayload(quotes) {
  return { quotes, seededAt: Date.now() };
}

test('maps quotes sorted by symbol, keeping null legs as null', () => {
  const rows = toVnStockQuoteRows(quotesPayload({
    VNM: { last: 57.6, ref: 58.1, ceiling: 62.1, floor: 54.1, changePct: -0.86, high: 58.1, low: 57.5, volume: 179370 },
    FPT: { last: 130.2, ref: 129.0, changePct: 0.93, high: null, low: null, volume: null },
    ACB: { last: 24.95 },
  }));
  assert.deepEqual(rows.map((r) => r.symbol), ['ACB', 'FPT', 'VNM']);
  const fpt = rows[1];
  assert.equal(fpt.high, null);
  assert.equal(fpt.volume, null);
  const acb = rows[0];
  assert.equal(acb.ref, null);
  assert.equal(acb.changePct, null);
});

test('drops quotes without a usable last price and rejects unusable payloads', () => {
  const rows = toVnStockQuoteRows(quotesPayload({
    VNM: { last: 57.6 },
    FPT: { last: 0 },
    ACB: { last: -1 },
    HPG: null,
  }));
  assert.deepEqual(rows.map((r) => r.symbol), ['VNM']);
  const payload = quotesPayload({ VNM: { last: 57.6 } });
  assert.equal(toVnStockQuoteRows({ _seed: {}, data: payload }).length, 1);
  for (const bad of [undefined, null, {}, { quotes: [] }, { quotes: null }, [], 'x', 42]) {
    assert.deepEqual(toVnStockQuoteRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

// ─── degraded detection ─────────────────────────────────────────────────────────

test('an empty board degrades the panel: named, not silently missing', () => {
  assert.deepEqual(degradedVnStocksSources({ indices: [{}], tickers: [{}] }), []);
  assert.deepEqual(degradedVnStocksSources({ indices: [], tickers: [{}] }), ['indices']);
  assert.deepEqual(degradedVnStocksSources({ indices: [{}], tickers: [] }), ['tickers']);
});
