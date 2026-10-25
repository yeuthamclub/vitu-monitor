// Petrolimex fuel board seeder + mapper — fork PR-2d.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parsePlxFuelBoard,
  validate,
} from '../scripts/seed-vn-fuel-prices.mjs';
import { toVnFuelRows } from '../src/services/economic/vn-fuel.ts';

// Trimmed from the live CMS response (2026-10-22 adjustment cycle).
function cmsPayload(objects) {
  return JSON.stringify({
    FilterBy: { And: [] },
    SortBy: { LastModified: 'Descending' },
    Pagination: { TotalRecords: objects.length, TotalPages: 1, PageSize: 0, PageNumber: 1 },
    Objects: objects,
  });
}

function item(title, z1, z2, mod = '2026-10-22T07:55:21.07Z') {
  return { Title: title, Status: 'Published', Zone1Price: z1, Zone2Price: z2, LastModified: mod };
}

const LIVE_BOARD = [
  item('Xăng E10 RON 95-V', 25710, 26220, '2026-10-22T07:52:54.709Z'),
  item('Xăng E10 RON 95-III', 24910, 25400, '2026-10-22T07:53:23.9Z'),
  item('Xăng E5 RON 92', 25060, 25560, '2026-10-22T07:53:40.68Z'),
  item('DO 0,001S-V', 30650, 31260, '2026-10-22T07:53:57.703Z'),
  item('DO 0,05S-II', 29250, 29830, '2026-10-22T07:54:21.279Z'),
  item('Dầu hỏa 2-K', 30050, 30650, '2026-10-22T07:55:21.07Z'),
];

test('parses the live CMS shape: products, zones, board as-of', () => {
  const board = parsePlxFuelBoard(cmsPayload(LIVE_BOARD));
  assert.equal(board.retailer, 'Petrolimex');
  assert.equal(Object.keys(board.products).length, 6);
  assert.equal(board.asOf, '2026-10-22T07:55:21.07Z');
  const e5 = board.products['Xăng E5 RON 92'];
  assert.equal(e5.zone1VndPerLiter, 25060);
  assert.equal(e5.zone2VndPerLiter, 25560);
  assert.equal(validate(board), true);
  assert.equal(declareRecords(board), 6);
});

test('structural surprises fail loud instead of publishing a partial board', () => {
  assert.throws(() => parsePlxFuelBoard('<html><body>maintenance</body></html>'), /not JSON/);
  assert.throws(() => parsePlxFuelBoard('{}'), /no Objects/);
  assert.throws(() => parsePlxFuelBoard(cmsPayload([])), /no Objects/);
  assert.throws(() => parsePlxFuelBoard(cmsPayload([item('', 25060, 25560)])), /no Title/);
  assert.throws(() => parsePlxFuelBoard(cmsPayload([item('Xăng E5 RON 92', 25060, null)])), /no zone price/);
});

test('validate anchors the baseline grade and zone sanity', () => {
  // No E5 RON 92 → not the national board.
  assert.equal(validate(parsePlxFuelBoard(cmsPayload([
    item('Xăng E10 RON 95-V', 25710, 26220),
    item('DO 0,05S-II', 29250, 29830),
    item('Dầu hỏa 2-K', 30050, 30650),
    item('DO 0,001S-V', 30650, 31260),
    item('Xăng E10 RON 95-III', 24910, 25400),
  ]))), false);
  // Below 5 products → truncated.
  assert.equal(validate(parsePlxFuelBoard(cmsPayload(LIVE_BOARD.slice(0, 4)))), false);
  // Out-of-band price.
  assert.equal(validate(parsePlxFuelBoard(cmsPayload([
    ...LIVE_BOARD.slice(0, 5),
    item('Dầu hỏa 2-K', 3005, 3065),
  ]))), false);
  // Zone 2 cheaper than Zone 1.
  assert.equal(validate(parsePlxFuelBoard(cmsPayload([
    ...LIVE_BOARD.slice(0, 5),
    item('Dầu hỏa 2-K', 30050, 29650),
  ]))), false);
  assert.equal(validate(undefined), false);
});

test('mapper keeps products with a usable zone pair, board order', () => {
  const payload = { retailer: 'Petrolimex', asOf: '2026-10-22T07:55:21.07Z', products: {
    'Xăng E5 RON 92': { zone1VndPerLiter: 25060, zone2VndPerLiter: 25560, lastModified: '2026-10-22T07:53:40.68Z' },
    'DO 0,05S-II': { zone1VndPerLiter: 29250, zone2VndPerLiter: null, lastModified: null },  // dropped
    'Dầu hỏa 2-K': { zone1VndPerLiter: 0, zone2VndPerLiter: 30650, lastModified: null },     // dropped
    'Mazút': null,                                                                            // dropped
  }, seededAt: Date.now() };
  const rows = toVnFuelRows(payload);
  assert.deepEqual(rows.map((r) => r.product), ['Xăng E5 RON 92']);
  assert.equal(rows[0].lastModified, '2026-10-22T07:53:40.68Z');
  // Envelope tolerance + unusable payloads.
  assert.equal(toVnFuelRows({ _seed: {}, data: payload }).length, 1);
  for (const bad of [undefined, null, {}, { products: [] }, [], 'x', 42]) {
    assert.deepEqual(toVnFuelRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});
