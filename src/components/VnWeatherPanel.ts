import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';

import {
  describeAqi,
  describeWeatherCode,
  toVnWeatherCityRows,
  type VnWeatherCityRow,
} from '@/services/vn-weather-cities';

/**
 * VN Weather panel — fork PR-3d.
 *
 * Open-Meteo current + 5-day forecast + AQI for 5 VN cities
 * (`vn:weather:v1`): each row is a city with current conditions, a US AQI
 * badge (color-graded), and a collapsible 5-day forecast strip. Ships
 * enabled by default in the vietnam variant alongside the NCHMF warnings.
 */
export class VnWeatherPanel extends Panel {
  private cities: VnWeatherCityRow[] = [];
  private loaded = false;
  private inFlight = false;

  constructor() {
    super({
      id: 'vn-weather',
      title: t('panels.vn-weather'),
      defaultRowSpan: 2,
    });
  }

  public async fetchData(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { ensureHydrated } = await import('@/services/bootstrap');
      const payload = await ensureHydrated('vnWeather').catch(() => undefined);
      if (!this.element?.isConnected) return;
      this.cities = toVnWeatherCityRows(payload);
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
    if (this.cities.length === 0) {
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
      return;
    }

    const rows = joinSafeHtml(this.cities.map((c) => {
      const wx = describeWeatherCode(c.current.weatherCode);
      const aqi = describeAqi(c.aqi.usAqi);
      const forecast = joinSafeHtml(c.daily.slice(0, 5).map((d) => {
        const precip = d.precipitationMm !== null && d.precipitationMm > 0
          ? safeHtml`<span class="wx-precip">${d.precipitationMm.toFixed(1)}mm</span>`
          : safeHtml``;
        return safeHtml`<div class="wx-day">
          <span class="wx-date">${d.date.slice(5)}</span>
          <span class="wx-range">${d.tempMin.toFixed(0)}°–${d.tempMax.toFixed(0)}°</span>
          ${precip}
        </div>`;
      }));
      return safeHtml`
        <tr>
          <td class="fx-ccy">
            <span class="fx-ccy-code">${wx.icon}</span>
            <span class="fx-ccy-country">${c.name}</span>
          </td>
          <td class="wx-temp">${c.current.temperatureC?.toFixed(1) ?? '--'}°C</td>
          <td class="fx-na">${c.current.humidityPct !== null ? `${c.current.humidityPct}%` : '--'}</td>
          <td class="fx-na">${c.current.windKmh !== null ? `${c.current.windKmh.toFixed(0)} km/h` : '--'}</td>
          <td class="${aqi.className}">${aqi.label}</td>
          <td class="wx-forecast">${forecast}</td>
        </tr>`;
    }));

    this.setSafeContent(safeHtml`
      <div class="fx-scroll">
        <table class="fx-table">
          <thead>
            <tr>
              <th scope="col" class="fx-ccy">${t('components.vnWeatherCities.now')}</th>
              <th scope="col">°C</th>
              <th scope="col">${t('components.vnWeatherCities.humidity')}</th>
              <th scope="col">${t('components.vnWeatherCities.wind')}</th>
              <th scope="col">${t('components.vnWeatherCities.aqi')}</th>
              <th scope="col">${t('components.vnWeatherCities.forecast')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="fx-footer">${t('components.vnWeatherCities.source')}</div>
    `);
  }
}
