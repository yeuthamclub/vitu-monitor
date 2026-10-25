// VN earthquake seeder + mapper — fork PR-3b.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parseUsgsQuakes,
  validate,
} from '../scripts/seed-vn-earthquakes.mjs';
import { toVnEarthquakeRows } from '../src/services/vn-earthquakes.ts';

// Trimmed from the live FDSN response (2026-10-25).
function fdsnPayload(features) {
  return JSON.stringify({
    type: 'FeatureCollection',
    metadata: { generated: 1792906064000, status: 200, count: features.length },
    features,
  });
}

function feature(id, mag, place, lat, lon, depth, timeMs) {
  return {
    id,
    properties: { mag, place, time: timeMs, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, tsunami: 0 },
    geometry: { type: 'Point', coordinates: [lon, lat, depth] },
  };
}

const NOW = Date.now();
const HOUR = 3600_000;
const LIVE_EVENTS = [
  feature('us7000abcd', 4.2, '37 km ESE of Sainyabuli, Laos', 19.10, 102.02, 10.261, NOW - 24 * HOUR),
  feature('us7000abce', 4.4, '33 km SE of Sơn La, Vietnam', 21.12, 104.16, 10, NOW - 5 * 24 * HOUR),
  feature('us7000abcf', 4.5, '29 km SW of Trà My, Vietnam', 15.16, 108.03, 10, NOW - 7 * 24 * HOUR),
  feature('us7000abcg', 4.4, '46 km S of Trà My, Vietnam', 14.92, 108.28, 10, NOW - 24 * 24 * HOUR),
];

test('parses the live FDSN shape: events, ordering, absolute urls', () => {
  const board = parseUsgsQuakes(fdsnPayload(LIVE_EVENTS));
  assert.equal(board.source, 'USGS-FDSN');
  assert.equal(board.events.length, 4);
  // Newest first regardless of input order.
  assert.equal(board.events[0].id, 'us7000abcd');
  const sonLa = board.events.find((e) => e.id === 'us7000abce');
  assert.equal(sonLa.magnitude, 4.4);
  assert.equal(sonLa.latitude, 21.12);
  assert.equal(sonLa.longitude, 104.16);
  assert.equal(sonLa.depthKm, 10);
  assert.ok(sonLa.url.includes('us7000abce'));
  assert.equal(validate(board), true);
  assert.equal(declareRecords(board), 4);
});

test('an empty feature list is a legitimate quiet window', () => {
  const board = parseUsgsQuakes(fdsnPayload([]));
  assert.equal(board.events.length, 0);
  assert.equal(validate(board), true);
  assert.equal(declareRecords(board), 0);
});

test('structural surprises fail loud instead of publishing garbage', () => {
  assert.throws(() => parseUsgsQuakes('<html>service unavailable</html>'), /not JSON/);
  assert.throws(() => parseUsgsQuakes(''), /is empty/);
  // Non-200 status (USGS signals errors inside a 200 body too).
  assert.throws(() => parseUsgsQuakes(JSON.stringify({ metadata: { status: 400 }, features: [] })), /answered status 400/);
  // Missing features array.
  assert.throws(() => parseUsgsQuakes('{"metadata":{"status":200}}'), /no features/);
});

test('validate catches corruption the parser tolerates silently', () => {
  assert.equal(validate(undefined), false);
  // Out-of-box coordinates.
  assert.equal(validate({ events: [{ id: 'x', magnitude: 4, place: '', latitude: 40, longitude: 104, depthKm: 10, time: new Date().toISOString(), url: null, tsunami: false }] }), false);
  // Below the M3 floor.
  assert.equal(validate({ events: [{ id: 'x', magnitude: 2.9, place: '', latitude: 15, longitude: 108, depthKm: 10, time: new Date().toISOString(), url: null, tsunami: false }] }), false);
  // Duplicate ids.
  const board = parseUsgsQuakes(fdsnPayload(LIVE_EVENTS));
  assert.equal(validate({ events: [...board.events, board.events[0]] }), false);
});

test('events older than the 30-day window are dropped', () => {
  const old = feature('us6000old1', 4.0, 'Ancient event, Vietnam', 16, 107, 10, NOW - 40 * 24 * HOUR);
  const board = parseUsgsQuakes(fdsnPayload([...LIVE_EVENTS, old]));
  assert.equal(board.events.length, 4);
});

test('mapper: newest first, malformed dropped, empty tolerated', () => {
  const payload = { source: 'USGS-FDSN', events: [
    { id: 'a', magnitude: 4.2, place: 'Laos', latitude: 19.1, longitude: 102.0, depthKm: 10, time: '2026-10-23T19:31:21.121Z', url: 'https://x', tsunami: false },
    { id: 'b', magnitude: 4.4, place: 'Sơn La', latitude: 21.1, longitude: 104.2, depthKm: 10, time: '2026-10-24T01:00:00.000Z', url: null, tsunami: true },
    { id: '', magnitude: 4, place: 'No id', latitude: 15, longitude: 108, depthKm: 5, time: '2026-10-24T00:00:00Z', url: null, tsunami: false }, // dropped
    { id: 'c', magnitude: 0, place: 'Zero mag', latitude: 15, longitude: 108, depthKm: 5, time: '2026-10-24T00:00:00Z', url: null, tsunami: false }, // dropped
    null, // dropped
  ], seededAt: Date.now() };
  const rows = toVnEarthquakeRows(payload);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a']); // input order b<a? b newer → first
  assert.equal(rows[0].tsunami, true);
  assert.equal(rows[1].url, 'https://x');
  assert.equal(toVnEarthquakeRows({ _seed: {}, data: payload }).length, 2);
  assert.deepEqual(toVnEarthquakeRows({ events: [] }), []);
  for (const bad of [undefined, null, {}, { events: null }, [], 'x', 42]) {
    assert.deepEqual(toVnEarthquakeRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});
