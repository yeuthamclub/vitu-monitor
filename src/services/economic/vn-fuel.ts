/**
 * Petrolimex retail fuel board mappers — the fork's PR-2d
 * (`vn:fuel-prices:v1`, seeded by scripts/seed-vn-fuel-prices.mjs from the
 * CMS API the site's own price widget calls). Prices are VNĐ per liter for
 * retail Zone 1 / Zone 2, moving only at national adjustment cycles.
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

export type VnFuelRow = {
  /** Vietnamese product name from the board, e.g. 'Xăng E5 RON 92'. */
  product: string;
  /** Retail Zone 1, VNĐ per liter. */
  zone1VndPerLiter: number;
  /** Retail Zone 2, VNĐ per liter (serving costs more there). */
  zone2VndPerLiter: number;
  /** The product's own last CMS update, ISO. */
  lastModified: string | null;
};

/**
 * Project `vn:fuel-prices:v1` onto fuel rows, board order. A product without
 * a usable zone pair is dropped — a half-priced row reads as a free liter.
 *
 * @param payload the `vn:fuel-prices:v1` value, enveloped or not
 */
export function toVnFuelRows(payload: unknown): VnFuelRow[] {
  const unwrapped = unwrapEnvelope(payload, 'products');
  if (!isRecord(unwrapped)) return [];
  const products = unwrapped.products;
  if (!isRecord(products)) return [];

  const rows: VnFuelRow[] = [];
  for (const [product, value] of Object.entries(products)) {
    if (!isRecord(value)) continue;
    const zone1VndPerLiter = finiteNumber(value.zone1VndPerLiter);
    const zone2VndPerLiter = finiteNumber(value.zone2VndPerLiter);
    if (zone1VndPerLiter === null || zone2VndPerLiter === null) continue;
    if (zone1VndPerLiter <= 0 || zone2VndPerLiter <= 0) continue;
    rows.push({ product, zone1VndPerLiter, zone2VndPerLiter, lastModified: nonEmptyString(value.lastModified) });
  }
  return rows;
}
