// SSI iBoard index seeder — fork PR-2c. The endpoint is an unofficial
// frontend API with no contract, so the parser fails loud on structural
// surprises and validate() anchors all three headline indices.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parseSsiIndex,
  validate,
  vnStockContentMeta,
} from '../scripts/seed-vn-stock-indices.mjs';

// Trimmed from the live board (2026-10-24). `time` is epoch ms.
function ssiData(overrides = {}) {
  return {
    latestValue: [],
    exchange: 'hose',
    indexId: 'VNINDEX',
    indexValue: 1774.15,
    prevIndexValue: 1760.63,
    time: 1792742705082,
    advances: 212,
    declines: 141,
    allQty: 812_345_678,
    allValue: 16_500_000_000_000,
    change: 13.52,
    ...overrides,
  };
}

test('parses the live board shape: level, derived pct, ISO time', () => {
  const row = parseSsiIndex('VNINDEX', ssiData());
  assert.equal(row.value, 1774.15);
  assert.equal(row.prevValue, 1760.63);
  assert.equal(row.change, 13.52);
  // Derived from value/prev, not trusted from a field.
  assert.equal(row.changePct, 0.77);
  assert.equal(row.exchange, 'hose');
  assert.equal(row.advances, 212);
  assert.equal(row.declines, 141);
  assert.equal(row.allValue, 16_500_000_000_000);
  assert.equal(row.time, new Date(1792742705082).toISOString());
});

test('change falls back to value − prev when the board omits it', () => {
  const { change, ...withoutChange } = ssiData();
  const row = parseSsiIndex('VNINDEX', withoutChange);
  assert.ok(Math.abs(row.change - 13.52) < 1e-9);
});

test('structural surprises fail loud instead of publishing a partial index', () => {
  assert.throws(() => parseSsiIndex('VNINDEX', null), /no data object/);
  assert.throws(() => parseSsiIndex('VNINDEX', ssiData({ indexValue: null })), /indexValue/);
  assert.throws(() => parseSsiIndex('VNINDEX', ssiData({ prevIndexValue: 0 })), /prevIndexValue/);
  assert.throws(() => parseSsiIndex('VNINDEX', ssiData({ time: 'x' })), /no time/);
});

function payloadWith(overrides) {
  return {
    indices: {
      VNINDEX: parseSsiIndex('VNINDEX', ssiData()),
      VN30: parseSsiIndex('VN30', ssiData({ indexId: 'VN30', indexValue: 1907.09, prevIndexValue: 1892.98, change: 14.11 })),
      HNXINDEX: parseSsiIndex('HNXINDEX', ssiData({ indexId: 'HNXIndex', exchange: 'hnx', indexValue: 262.7, prevIndexValue: 261.08, change: 1.62 })),
      ...overrides,
    },
    asOf: new Date(1792742705082).toISOString(),
    seededAt: Date.now(),
  };
}

test('validate anchors all three headline indices', () => {
  const payload = payloadWith();
  assert.equal(validate(payload), true);
  assert.equal(declareRecords(payload), 3);
  assert.ok(vnStockContentMeta(payload), 'content meta derives from board time');

  // Missing any headline index fails.
  assert.equal(validate(payloadWith({ VN30: undefined })), false);
  // A garbage level fails.
  assert.equal(validate(payloadWith({
    VN30: parseSsiIndex('VN30', ssiData({ indexValue: 999_999, prevIndexValue: 1892.98, change: 1 })),
  })), false);
  // A ±100% day is corruption, not a market.
  assert.equal(validate(payloadWith({
    HNXINDEX: parseSsiIndex('HNXINDEX', ssiData({ indexValue: 250, prevIndexValue: 100, change: 150 })),
  })), false);
  assert.equal(validate(undefined), false);
});
