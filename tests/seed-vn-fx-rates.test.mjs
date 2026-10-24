// Vietcombank FX board seeder — fork PR-2a.
//
// The board is a hand-rolled XML file whose shape has no contract beyond the
// file itself, so the parser must fail loud on any structural surprise
// (BUILD-PLAN §5.7: a layout change is a source error, never an empty write)
// and the validator must anchor the dollar pair so page-wide corruption cannot
// publish. These tests pin both, plus the quote direction the panel relies on:
// every amount is VNĐ per 1 unit, buy ≤ transfer ≤ sell.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parseVcbFxBoard,
  validate,
  vnFxContentMeta,
} from '../scripts/seed-vn-fx-rates.mjs';

// Trimmed from the live board shape (2026-10-24): MM/DD/YYYY h:mm:ss AM/PM
// board time, thousands-comma VNĐ amounts, attributes on every Exrate row.
function boardXml({ dateTime = '10/24/2026 7:03:04 PM', rows } = {}) {
  const exrates = (rows ?? [
    ['AUD', '17,668.37', '17,846.84', '18,418.90'],
    ['CAD', '19,213.55', '19,405.60', '19,876.35'],
    ['CHF', '30,166.92', '30,468.66', '31,208.62'],
    ['CNY', '3,602.61', '3,638.66', '3,726.85'],
    ['DKK', '3,762.38', '3,800.02', '3,892.15'],
    ['EUR', '28,058.32', '28,339.36', '29,027.42'],
    ['GBP', '33,224.37', '33,556.86', '34,171.28'],
    ['HKD', '3,353.29', '3,386.85', '3,468.98'],
    ['JPY', '171.83', '173.54', '177.75'],
    ['KRW', '18.32', '18.51', '19.03'],
    ['LAK', '1.27', '1.29', '1.35'],
    ['MYR', '5,874.66', '5,933.49', '6,077.40'],
    ['NOK', '2,422.19', '2,446.43', '2,505.79'],
    ['RUB', '313.95', '317.09', '324.80'],
    ['SEK', '2,510.71', '2,535.85', '2,597.44'],
    ['SGD', '19,865.23', '20,064.18', '20,542.63'],
    ['THB', '785.12', '792.97', '811.83'],
    ['USD', '26,330', '26,368', '26,456'],
  ]).map(([code, buy, transfer, sell]) =>
    `<Exrate CurrencyCode="${code}" CurrencyName="X" Buy="${buy}" Transfer="${transfer}" Sell="${sell}"/>`,
  ).join('');
  return `<ExrateList><DateTime>${dateTime}</DateTime>${exrates}</ExrateList>`;
}

test('parses the live board shape: +07:00 asOf, comma thousands, all rows', () => {
  const board = parseVcbFxBoard(boardXml());
  assert.equal(board.bank, 'Vietcombank');
  assert.equal(board.asOf, '2026-10-24T19:03:04+07:00');
  assert.equal(board.asOfDate, '2026-10-24');
  assert.equal(Object.keys(board.rates).length, 18);
  // Direction survives the parse: USD reads ~26k VNĐ per 1 USD.
  assert.deepEqual(board.rates.USD, { buy: 26330, transfer: 26368, sell: 26456 });
  assert.equal(board.rates.AUD.buy, 17668.37);
  // Sub-unit currencies (JPY, KRW, LAK) stay fractional, not zero.
  assert.ok(board.rates.JPY.sell > 100 && board.rates.JPY.sell < 200);
  assert.ok(board.rates.KRW.sell > 10 && board.rates.KRW.sell < 30);
});

test('board time is Vietcombank local time: 12-hour edge cases normalize', () => {
  assert.equal(
    parseVcbFxBoard(boardXml({ dateTime: '10/24/2026 12:05:09 AM' })).asOf,
    '2026-10-24T00:05:09+07:00',
  );
  assert.equal(
    parseVcbFxBoard(boardXml({ dateTime: '1/2/2026 12:30:00 PM' })).asOf,
    '2026-01-02T12:30:00+07:00',
  );
});

test('amounts parse with or without thousands commas, and dashes mean no quote', () => {
  const board = parseVcbFxBoard(boardXml({
    rows: [
      ['USD', '26,330', '26,368', '26,456'],   // comma-grouped integer
      ['DKK', '3697', '3705', '3742'],          // bare integer (live 2026-10-24 board)
      ['EUR', '28,058.32', '28,339.36', '29,027.42'], // comma + decimals
      ['JPY', '171.83', '173.54', '177.75'],    // decimals only
      ['SAR', '-', '6,842.95', '7,137.64'],     // live board: no cash buy for this pair
    ],
  }));
  assert.equal(board.rates.DKK.sell, 3742);
  assert.equal(board.rates.EUR.buy, 28058.32);
  // A dashed leg is a legitimate missing quote: null, not zero, not dropped.
  assert.deepEqual(board.rates.SAR, { buy: null, transfer: 6842.95, sell: 7137.64 });
  // 5 rows fail the ≥15 count, but proves dashed rows parse and validate
  // without throwing.
  assert.equal(validate(board), false);
  // Malformed grouping still fails loud rather than guessing.
  assert.throws(() => parseVcbFxBoard(boardXml({
    rows: [['USD', '26,33O', '26,368', '26,456']], // letter O for zero
  })), /not understood/);
  assert.throws(() => parseVcbFxBoard(boardXml({
    rows: [['USD', '26330,000', '26,368', '26,456']], // bad grouping
  })), /not understood/);
});

test('structural surprises fail loud instead of publishing partial data', () => {
  // A layout change serves HTML/JS challenge text, not the board.
  assert.throws(() => parseVcbFxBoard('<html><body>maintenance</body></html>'), /ExrateList/);
  // Missing DateTime.
  assert.throws(() => parseVcbFxBoard('<ExrateList><Exrate CurrencyCode="USD" Buy="1" Transfer="1" Sell="1"/></ExrateList>'), /DateTime/);
  // Unparseable DateTime.
  assert.throws(() => parseVcbFxBoard(boardXml({ dateTime: '24/10/2026' })), /DateTime/);
  // Empty board.
  assert.throws(() => parseVcbFxBoard('<ExrateList><DateTime>10/24/2026 7:03:04 PM</DateTime></ExrateList>'), /Exrate rows/);
  // Empty amount on one row fails the whole board.
  assert.throws(() => parseVcbFxBoard(boardXml({
    rows: [['USD', '26,330', '26,368', '26,456'], ['EUR', '28,058.32', '', '29,027.42']],
  })), /not understood/);
  // A row with every leg dashed is not a quote at all.
  assert.throws(() => parseVcbFxBoard(boardXml({
    rows: [['USD', '26,330', '26,368', '26,456'], ['EUR', '-', '-', '-']],
  })), /no numeric amount/);
  // Malformed currency code.
  assert.throws(() => parseVcbFxBoard(boardXml({
    rows: [['USDT2', '1', '1', '1']],
  })), /CurrencyCode/);
});

test('validate anchors the dollar pair and the board-wide invariants', () => {
  assert.equal(validate(parseVcbFxBoard(boardXml())), true);

  // Too few currencies to be the real board.
  assert.equal(validate(parseVcbFxBoard(boardXml({
    rows: [['USD', '26,330', '26,368', '26,456']],
  }))), false);

  // No USD anchor.
  assert.equal(validate(parseVcbFxBoard(boardXml({
    rows: [['EUR', '28,058.32', '28,339.36', '29,027.42']],
  }))), false);

  // USD far outside any plausible VND band.
  assert.equal(validate(parseVcbFxBoard(boardXml({
    rows: [['USD', '2,633', '2,636', '2,645']],
  }))), false);

  // Spread inverted anywhere on the board.
  assert.equal(validate(parseVcbFxBoard(boardXml({
    rows: [
      ['USD', '26,330', '26,368', '26,456'],
      ['EUR', '30,058.32', '29,339.36', '29,027.42'], // buy > transfer > sell
    ],
  }))), false);

  assert.equal(validate(undefined), false);
});

test('contract fields: record count and content-age meta from the board date', () => {
  const board = parseVcbFxBoard(boardXml());
  assert.equal(declareRecords(board), 18);
  const meta = vnFxContentMeta(board);
  assert.ok(meta, 'content meta derives from the board date');
  assert.ok(String(new Date(meta.newestItemAt).toISOString()).startsWith('2026-10-24'));
});
