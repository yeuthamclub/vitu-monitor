import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';

import { toVnEarthquakeRows, type VnEarthquakeRow } from '@/services/vn-earthquakes';

/**
 * VN Earthquakes panel — fork PR-3b.
 *
 * The USGS FDSN board over the Vietnam bounding box
 * (`vn:earthquakes:v1`): M≥3 events of the last 30 days, newest first,
 * magnitude-graded rows linking to the USGS detail page. An empty board is
 * a legitimate quiet window (seismicity is sporadic), not an outage.
 *
 * The authoritative domestic bulletin (Viện Vật lý Địa cầu) is
 * DNS-unreachable from the current egress; until that changes, USGS is the
 * source and the footer says so.
 */
export class VnEarthquakesPanel extends Panel {
  private rows: VnEarthquakeRow[] = [];
  private loaded = false;
  private inFlight = false;

  constructor() {
    super({
      id: 'vn-earthquakes',
      title: t('panels.vn-earthquakes'),
      defaultRowSpan: 2,
    });
  }

  public async fetchData(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { ensureHydrated } = await import('@/services/bootstrap');
      const payload = await ensureHydrated('vnEarthquakes').catch(() => undefined);
      if (!this.element?.isConnected) return;
      this.rows = toVnEarthquakeRows(payload);
      this.loaded = true;
      this.render();
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
    } finally {
      this.inFlight = false;
    }
  }

  /** Magnitude grading follows how VN bulletins describe felt intensity. */
  private magClass(magnitude: number): string {
    if (magnitude >= 5) return 'vn-quake-major';
    if (magnitude >= 4) return 'vn-quake-moderate';
    return 'vn-quake-minor';
  }

  private render(): void {
    if (!this.loaded) return;

    // A quiet month is the region, not an outage (the seeder fails loud
    // upstream), so an empty board states the quiet window.
    if (this.rows.length === 0) {
      this.setSafeContent(safeHtml`<div class="fx-footer">${t('components.vnEarthquakes.empty')}</div>`);
      return;
    }

    const rows = joinSafeHtml(this.rows.map((r) => safeHtml`
      <tr class="${this.magClass(r.magnitude)}">
        <td class="fx-ccy"><span class="fx-ccy-code">M${r.magnitude.toFixed(1)}</span></td>
        <td>${r.url
          ? safeHtml`<a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.place}</a>${r.tsunami ? ' 🌊' : ''}`
          : safeHtml`${r.place}${r.tsunami ? ' 🌊' : ''}`}</td>
        <td class="fx-na">${r.depthKm.toFixed(0)}</td>
        <td class="fx-na">${new Date(r.time).toLocaleString()}</td>
      </tr>`));

    this.setSafeContent(safeHtml`
      <div class="fx-scroll">
        <table class="fx-table">
          <thead>
            <tr>
              <th scope="col" class="fx-ccy">${t('components.vnEarthquakes.magnitude')}</th>
              <th scope="col">${t('components.vnEarthquakes.place')}</th>
              <th scope="col">${t('components.vnEarthquakes.depth')}</th>
              <th scope="col">${t('components.vnEarthquakes.time')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="fx-footer">${t('components.vnEarthquakes.source')}</div>
    `);
  }
}
