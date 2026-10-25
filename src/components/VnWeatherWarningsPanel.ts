import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';

import { toVnWeatherWarningRows, type VnWeatherWarningRow } from '@/services/vn-weather';

/**
 * VN Weather Warnings panel — fork PR-3a.
 *
 * The NCHMF bulletin board (`vn:weather-warnings:v1`): the national
 * hydromet service's live warning/forecast bulletins, hazard-titled items
 * first, each linking out to the original bulletin on nchmf.gov.vn. This is
 * the variant's hazard headline surface, so unlike the market panels it
 * ships ENABLED by default in the vietnam variant.
 */
export class VnWeatherWarningsPanel extends Panel {
  private rows: VnWeatherWarningRow[] = [];
  private loaded = false;
  private inFlight = false;

  constructor() {
    super({
      id: 'vn-weather-warnings',
      title: t('panels.vn-weather-warnings'),
      defaultRowSpan: 2,
    });
  }

  public async fetchData(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { ensureHydrated } = await import('@/services/bootstrap');
      const payload = await ensureHydrated('vnWeatherWarnings').catch(() => undefined);
      if (!this.element?.isConnected) return;
      this.rows = toVnWeatherWarningRows(payload);
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

  private render(): void {
    if (!this.loaded) return;

    // An empty board is a legitimate calm-weather state, not an outage: the
    // seeder fails loud upstream, so an empty list here means the service
    // published nothing — say so instead of showing an error.
    if (this.rows.length === 0) {
      this.setSafeContent(safeHtml`<div class="fx-footer">${t('components.vnWeather.empty')}</div>`);
      return;
    }

    const rows = joinSafeHtml(this.rows.map((r) => safeHtml`
      <tr class="${r.kind === 'warning' ? 'vn-wx-warning' : 'vn-wx-forecast'}">
        <td class="fx-ccy">
          <span class="fx-ccy-code">${r.kind === 'warning' ? '⚠' : 'ℹ'}</span>
        </td>
        <td><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title}</a></td>
      </tr>`));

    this.setSafeContent(safeHtml`
      <div class="fx-scroll">
        <table class="fx-table">
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="fx-footer">${t('components.vnWeather.source')}</div>
    `);
  }
}
