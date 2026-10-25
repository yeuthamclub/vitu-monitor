// NCHMF warning board seeder + mapper — fork PR-3a.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parseNchmfBoard,
  validate,
} from '../scripts/seed-vn-weather-warnings.mjs';
import { toVnWeatherWarningRows } from '../src/services/vn-weather.ts';

// Trimmed from the live homepage (2026-10-25): bulletin posts on /kttv/.
function homepageHtml(items) {
  const links = items.map(([id, title]) =>
    `<a href="/kttv/vi-VN/1/slug-post${id}.html">${title}</a>`,
  ).join('\n');
  return `<html><body><div class="menu">/kttv/ sidebar</div><div class="news">${links}</div></body></html>`;
}

const LIVE_ITEMS = [
  [54765, 'BẢN TIN DỰ BÁO, CẢNH BÁO THỦY VĂN THỜI HẠN NGẮN'],
  [54762, 'TIN CẢNH BÁO LŨ QUÉT SÁT LỞ ĐẤT, SỤT LÚN ĐẤT DO MƯA LŨ TRÊN KHU VỰC TỈNH NGHỆ AN'],
  [54761, 'TIN CẢNH BÁO LŨ QUÉT SÁT LỞ ĐẤT, SỤT LÚN ĐẤT DO MƯA LŨ TRÊN KHU VỰC TỈNH GIÁ LAI'],
  [54746, 'TIN CẢNH BÁO, DỰ BÁO TRIỀU CƯỜNG VÙNG VEN BIỂN NAM BỘ'],
  [54280, 'Bản tin dự báo sóng 10 ngày tới (từ ngày 25/10 đến ngày 03/11/2026)'],
  [54271, 'Dự báo trường nước dâng lớn nhất 3 ngày tới'],
];

test('parses the live board: dedupe by post id, newest first, kind by title', () => {
  const board = parseNchmfBoard(homepageHtml(LIVE_ITEMS));
  assert.equal(board.source, 'NCHMF');
  assert.equal(board.items.length, 6);
  // Newest post leads.
  assert.equal(board.items[0].postId, 54765);
  // Relative hrefs become absolute.
  assert.equal(board.items[0].url, 'https://www.nchmf.gov.vn/kttv/vi-VN/1/slug-post54765.html');
  // Severity vocabulary classification.
  assert.equal(board.items[0].kind, 'warning');  // "CẢNH BÁO"
  assert.equal(board.items[4].kind, 'forecast'); // routine 10-day swell bulletin
  // Duplicate post ids collapse to the first occurrence.
  assert.equal(validate(board), true);
  assert.equal(declareRecords(board), 6);
});

test('a duplicate post id presented twice collapses', () => {
  const board = parseNchmfBoard(homepageHtml([...LIVE_ITEMS, LIVE_ITEMS[0]]));
  assert.equal(board.items.length, 6);
  assert.equal(validate(board), true);
});

test('structural surprises fail loud instead of publishing a partial board', () => {
  assert.throws(() => parseNchmfBoard('<html><body>maintenance</body></html>'), /layout changed/);
  assert.throws(() => parseNchmfBoard(''), /is empty/);
  // Below the minimum bulletin count — the board fell off the page.
  assert.throws(() => parseNchmfBoard(homepageHtml(LIVE_ITEMS.slice(0, 2))), /yielded only 2/);
});

test('validate catches corruption the parser cannot', () => {
  assert.equal(validate(undefined), false);
  assert.equal(validate({ items: [] }), false);
  // Duplicate ids (breaks ordering) and bad kinds fail.
  const board = parseNchmfBoard(homepageHtml(LIVE_ITEMS));
  assert.equal(validate({ items: [...board.items, board.items[0]] }), false);
  assert.equal(validate({ items: board.items.map((i, idx) => ({ ...i, kind: idx === 0 ? 'alert' : i.kind })) }), false);
  // Ascending order fails — the panel would lead with stale items.
  assert.equal(validate({ items: [...board.items].reverse() }), false);
});

test('mapper: hazard items first, newest first, malformed dropped', () => {
  const payload = { source: 'NCHMF', items: [
    { postId: 54280, title: 'Bản tin dự báo sóng 10 ngày tới', url: 'https://www.nchmf.gov.vn/x', kind: 'forecast' },
    { postId: 54762, title: 'TIN CẢNH BÁO LŨ QUÉT SÁT LỞ ĐẤT', url: 'https://www.nchmf.gov.vn/y', kind: 'warning' },
    { postId: 54761, title: 'TIN CẢNH BÁO LŨ QUÉT KHU VỰC KHÁC', url: 'https://www.nchmf.gov.vn/z', kind: 'warning' },
    { postId: 54700, title: 'No url', kind: 'forecast' },          // dropped
    { postId: 0, title: 'Bad id', url: 'https://www.nchmf.gov.vn/', kind: 'warning' }, // dropped
  ], seededAt: Date.now() };
  const rows = toVnWeatherWarningRows(payload);
  assert.deepEqual(rows.map((r) => r.postId), [54762, 54761, 54280]);
  // Envelope tolerance + unusable payloads.
  assert.equal(toVnWeatherWarningRows({ _seed: {}, data: payload }).length, 3);
  for (const bad of [undefined, null, {}, { items: null }, [], 'x', 42]) {
    assert.deepEqual(toVnWeatherWarningRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});
