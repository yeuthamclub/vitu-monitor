/**
 * VN stock board row mappers — the fork's PR-2c.
 *
 * Two seeded payloads feed the VN Stocks panel:
 *
 * | key                    | shape                          | fields             |
 * |------------------------|--------------------------------|--------------------|
 * | `vn:stock-indices:v1`  | `{ indices: {...} }`           | SSI iBoard quotes  |
 * | `vn:stock-quotes:v1`   | `{ quotes: {...} }`            | VPS board quotes   |
 *
 * Both arrive as `{_seed, data}` envelopes on the on-demand bootstrap path,
 * like every other payload the panel family renders (see fx-rates.ts).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapEnvelope(payload: unknown, marker?: string): unknown {
  if (!isRecord(payload)) return payload;
  if (marker !== undefined && marker in payload) return payload;
  if (isRecord(payload.data)) return payload.data;
  return payload;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** One SSI iBoard index quote — VNINDEX, VN30, HNXIndex. */
export type VnStockIndexRow = {
  /** Board index id, e.g. 'VNINDEX'. */
  indexId: string;
  /** Latest index level. */
  value: number;
  /** Previous close level. */
  prevValue: number;
  /** Absolute change vs previous close, in index points. */
  change: number;
  /** Change as % of the previous close. */
  changePct: number;
  /** Board time, ISO. */
  time: string | null;
  /** Exchange the index belongs to ('hose' | 'hnx'), as the board reports. */
  exchange: string | null;
  advances: number | null;
  declines: number | null;
  /** Session matched value, VND. */
  allValue: number | null;
};

/** One VPS board quote — a HOSE blue-chip ticker. */
export type VnStockQuoteRow = {
  symbol: string;
  /** Last traded price, thousand VND (VN quotes prices in đồng ×10). */
  last: number;
  /** Session reference price. */
  ref: number | null;
  ceiling: number | null;
  floor: number | null;
  /** Change vs reference as %. */
  changePct: number | null;
  high: number | null;
  low: number | null;
  /** Matched volume this session, shares. */
  volume: number | null;
};

const INDEX_ORDER = ['VNINDEX', 'VN30', 'HNXINDEX'] as const;

/**
 * Project `vn:stock-indices:v1` onto index rows, headline order.
 * A malformed index entry is dropped, not rendered half-formed.
 *
 * @param payload the `vn:stock-indices:v1` value, enveloped or not
 */
export function toVnStockIndexRows(payload: unknown): VnStockIndexRow[] {
  const unwrapped = unwrapEnvelope(payload, 'indices');
  if (!isRecord(unwrapped)) return [];
  const indices = unwrapped.indices;
  if (!isRecord(indices)) return [];

  const rows: VnStockIndexRow[] = [];
  for (const indexId of INDEX_ORDER) {
    const value = indices[indexId];
    if (!isRecord(value)) continue;
    const level = finiteNumber(value.value);
    const prevValue = finiteNumber(value.prevValue);
    if (level === null || level <= 0 || prevValue === null || prevValue <= 0) continue;
    const change = finiteNumber(value.change) ?? level - prevValue;
    rows.push({
      indexId,
      value: level,
      prevValue,
      change,
      changePct: +((change / prevValue) * 100).toFixed(2),
      time: nonEmptyString(value.time),
      exchange: nonEmptyString(value.exchange),
      advances: finiteNumber(value.advances),
      declines: finiteNumber(value.declines),
      allValue: finiteNumber(value.allValue),
    });
  }
  return rows;
}

/**
 * Project `vn:stock-quotes:v1` onto quote rows, symbol order.
 * A quote without a usable last price is dropped (outside trading the board
 * still carries the last close, so a live empty means an unquoted row).
 *
 * @param payload the `vn:stock-quotes:v1` value, enveloped or not
 */
export function toVnStockQuoteRows(payload: unknown): VnStockQuoteRow[] {
  const unwrapped = unwrapEnvelope(payload, 'quotes');
  if (!isRecord(unwrapped)) return [];
  const quotes = unwrapped.quotes;
  if (!isRecord(quotes)) return [];

  const rows: VnStockQuoteRow[] = [];
  for (const [symbol, value] of Object.entries(quotes)) {
    if (!isRecord(value)) continue;
    const last = finiteNumber(value.last);
    if (last === null || last <= 0) continue;
    rows.push({
      symbol,
      last,
      ref: finiteNumber(value.ref),
      ceiling: finiteNumber(value.ceiling),
      floor: finiteNumber(value.floor),
      changePct: finiteNumber(value.changePct),
      high: finiteNumber(value.high),
      low: finiteNumber(value.low),
      volume: finiteNumber(value.volume),
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Sources that yielded no usable rows this load. */
export type VnStocksSourceId = 'indices' | 'tickers';

export type VnStocksPanelRows = {
  indices: VnStockIndexRow[];
  tickers: VnStockQuoteRow[];
  degraded: VnStocksSourceId[];
};

export function degradedVnStocksSources(rows: Omit<VnStocksPanelRows, 'degraded'>): VnStocksSourceId[] {
  const degraded: VnStocksSourceId[] = [];
  // Three indices and ~30 blue chips have no plausible genuine empty.
  if (rows.indices.length === 0) degraded.push('indices');
  if (rows.tickers.length === 0) degraded.push('tickers');
  return degraded;
}
