/**
 * Fork-only: Vietnamese sovereignty labels the vietnam variant draws on every
 * map renderer, above the basemap and independent of the layer toggles. The
 * public basemaps (OpenFreeMap/Protomaps, OSM data) do not reliably label the
 * archipelagos at every zoom or in every UI language, so the dashboard states
 * them itself. Positions are each feature's approximate visual centre.
 */
export interface VnSovereigntyLabel {
  text: string;
  lon: number;
  lat: number;
  /** Sea names render larger and lighter than archipelago names. */
  kind: 'archipelago' | 'sea';
}

export const VN_SOVEREIGNTY_LABELS: readonly VnSovereigntyLabel[] = [
  { text: 'Quần đảo Hoàng Sa (Việt Nam)', lon: 112.0, lat: 16.5, kind: 'archipelago' },
  { text: 'Quần đảo Trường Sa (Việt Nam)', lon: 114.4, lat: 9.9, kind: 'archipelago' },
  { text: 'Biển Đông', lon: 115.6, lat: 13.2, kind: 'sea' },
];
