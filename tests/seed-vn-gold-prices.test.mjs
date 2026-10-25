// PNJ gold board seeder — fork PR-2b.
//
// The board is an unofficial frontend API with no contract beyond the
// payload itself, so the parser must fail loud on any structural surprise
// (BUILD-PLAN §5.7) and the validator must anchor the SJC bar so a truncated
// or corrupted board cannot publish. These tests pin both, plus the unit
// conversion the panel relies on: raw PNJ integers are nghìn VNĐ per CHỈ,
// and the rows carry VNĐ per TAEEL (1 tael = 10 chỉ).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parsePnjGoldBoard,
  validate,
  vnGoldContentMeta,
} from '../scripts/seed-vn-gold-prices.mjs';

// Trimmed from the live board shape (2026-10-24): data rows keyed by masp,
// giamua/giaban as raw integers, updateDate as DD/MM/YYYY HH:mm:ss board time.
function boardPayload({ updateDate = '24/10/2026 09:38:51', rows } = {}) {
  const data = rows ?? [
    ['SJC', 'Vàng miếng SJC 999.9', 14170, 13870],
    ['N24K', 'Nhẫn Trơn PNJ 999.9', 14100, 13800],
    ['KB', 'Vàng Kim Bảo 999.9', 14100, 13800],
    ['TL', 'Vàng Phúc Lộc Tài 999.9', 14100, 13800],
    ['PNJ', 'Vàng nhẫn PNJ 999.9', 14100, 13800],
    ['24K', 'Vàng 24K PNJ', 14080, 13780],
    ['18K', 'Vàng 18K PNJ', 10750, 10100],
    ['14K', 'Vàng 14K PNJ', 8450, 7900],
    ['RAW_9999', 'Nguyên liệu vàng 999.9', 13980, 13680],
    ['RAW_9900', 'Nguyên liệu vàng 99', 13720, 13300],
  ];
  return JSON.stringify({
    data: (rows ?? data).map(([masp, tensp, giaban, giamua]) => ({ masp, tensp, giaban, giamua })),
    updateDate,
    chinhanh: 'hochiminh',
    note: '(*) Áp dụng cho các trang sức ngoài PNJ.',
  });
}

test('parses the live board shape: +07:00 asOf, per-chỉ raw, per-tael VND', () => {
  const board = parsePnjGoldBoard(boardPayload());
  assert.equal(board.store, 'PNJ');
  assert.equal(board.asOf, '2026-10-24T09:38:51+07:00');
  assert.equal(board.asOfDate, '2026-10-24');
  const codes = Object.keys(board.products);
  assert.equal(codes.length, 10);
  // Direction + unit conversion: giaban 14170 (nghìn VNĐ/chỉ) = 141.7m VNĐ/tael.
  const sjc = board.products.SJC;
  assert.equal(sjc.name, 'Vàng miếng SJC 999.9');
  assert.equal(sjc.buyPerChiRaw, 13870);
  assert.equal(sjc.sellPerChiRaw, 14170);
  assert.equal(sjc.buyVndPerTael, 13870 * 10_000);
  assert.equal(sjc.sellVndPerTael, 14170 * 10_000);
  // The footnote survives for the UI to surface.
  assert.match(board.note, /trang sức/);
});

test('structural surprises fail loud instead of publishing partial data', () => {
  // A Cloudflare challenge page is not a board.
  assert.throws(() => parsePnjGoldBoard('<html><body>Just a moment...</body></html>'), /not JSON/);
  // Empty board.
  assert.throws(() => parsePnjGoldBoard(JSON.stringify({ data: [], updateDate: '24/10/2026 09:38:51' })), /data rows/);
  // Missing or unparseable updateDate.
  assert.throws(() => parsePnjGoldBoard(boardPayload({ updateDate: '2026-10-24 09:38' })), /updateDate/);
  // A row without a product code.
  assert.throws(() => parsePnjGoldBoard(boardPayload({
    rows: [['', 'Vàng miếng SJC 999.9', 14170, 13870]],
  })), /masp/);
  // Fractional amounts are not the board's integer shape.
  assert.throws(() => parsePnjGoldBoard(boardPayload({
    rows: [['SJC', 'Vàng miếng SJC 999.9', 14170.5, 13870]],
  })), /is not an integer/);
});

test('validate anchors the SJC bar and the board-wide invariants', () => {
  assert.equal(validate(parsePnjGoldBoard(boardPayload())), true);

  // A truncated board (live carries ~20 lines) is not publishable.
  assert.equal(validate(parsePnjGoldBoard(boardPayload({
    rows: [['SJC', 'Vàng miếng SJC 999.9', 14170, 13870]],
  }))), false);

  // No SJC anchor.
  assert.equal(validate(parsePnjGoldBoard(boardPayload({
    rows: [['N24K', 'Nhẫn Trơn PNJ 999.9', 14100, 13800]],
  }))), false);

  // SJC far outside any plausible band.
  assert.equal(validate(parsePnjGoldBoard(boardPayload({
    rows: [['SJC', 'Vàng miếng SJC 999.9', 1417, 1387]],
  }))), false);

  // Spread inverted anywhere on the board.
  assert.equal(validate(parsePnjGoldBoard(boardPayload({
    rows: [
      ['SJC', 'Vàng miếng SJC 999.9', 14170, 13870],
      ['N24K', 'Nhẫn Trơn PNJ 999.9', 13800, 14100], // giaban < giamua
    ],
  }))), false);

  assert.equal(validate(undefined), false);
});

test('empty or dashed legs mean not-currently-quoted, not a broken board', () => {
  // Live 2026-10-24 board: RAW_* scrap lines carry empty strings outside
  // trading. The row stays with null legs; a row with no quote at all is
  // dropped; anything else non-integer still fails loud.
  const board = parsePnjGoldBoard(boardPayload({
    rows: [
      ['SJC', 'Vàng miếng SJC 999.9', 14170, 13870],
      ['RAW_9999', 'Nguyên liệu vàng 999.9', '', 13680],   // giaban empty
      ['RAW_9900', 'Nguyên liệu vàng 99', '-', '-'],       // both dashed → dropped
      ['N24K', 'Nhẫn Trơn PNJ 999.9', '', 13800],
    ],
  }));
  assert.deepEqual(board.products.RAW_9999, {
    name: 'Nguyên liệu vàng 999.9',
    buyPerChiRaw: 13680,
    sellPerChiRaw: null,
    buyVndPerTael: 136_800_000,
    sellVndPerTael: null,
  });
  assert.ok(!('RAW_9900' in board.products), 'all-empty rows are dropped');
  assert.equal(board.products.N24K.sellVndPerTael, null);
  // validate tolerates empty legs but still requires the SJC sell anchor.
  assert.equal(validate(board), false); // 3 priced rows < 10
});

test('contract fields: record count and content-age meta from the board date', () => {
  const board = parsePnjGoldBoard(boardPayload());
  assert.equal(declareRecords(board), 10);
  const meta = vnGoldContentMeta(board);
  assert.ok(meta, 'content meta derives from the board date');
  assert.ok(new Date(meta.newestItemAt).toISOString().startsWith('2026-10-24'));
});
