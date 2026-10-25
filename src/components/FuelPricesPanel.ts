import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml, unsafeRawHtml } from '@/utils/sanitize';
import { ensureHydrated, getHydratedData } from '@/services/bootstrap';
import { toVnFuelRows, type VnFuelRow } from '@/services/economic/vn-fuel';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';

import type { ListFuelPricesResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { EconomicServiceClient } from '@/services/generated-rpc-clients';

const getEconomicClient = createLazyClient(() => new EconomicServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

export class FuelPricesPanel extends Panel {
  private vnRows: VnFuelRow[] = [];

  constructor() {
    super({ id: 'fuel-prices', title: t('panels.fuelPrices'), infoTooltip: t('components.fuelPrices.infoTooltip') });
  }

  public async fetchData(): Promise<void> {
    // The fork's Petrolimex board rides the same panel (PR-2d). Either board
    // alone is enough to render: a dead VN source must not blank the global
    // table, and a missing global table (an unseeded self-hosted install) must
    // not hide the VN board. Awaited so the first render already includes it.
    this.vnRows = toVnFuelRows(await ensureHydrated('vnFuelPrices').catch(() => undefined));
    try {
      const hydrated = getHydratedData('fuelPrices') as ListFuelPricesResponse | undefined;
      if (hydrated?.countries?.length) {
        if (!this.element?.isConnected) return;
        this.renderIndex(hydrated);
        void getEconomicClient().listFuelPrices({}).then(data => {
          if (!this.element?.isConnected || !data.countries?.length) return;
          this.renderIndex(data);
        }).catch(() => {});
        return;
      }
      const data = await getEconomicClient().listFuelPrices({});
      if (!this.element?.isConnected) return;
      this.renderIndex(data);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      if (this.vnRows.length > 0) {
        this.renderVnOnly();
        return;
      }
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
    }
  }

  private renderVnOnly(): void {
    this.setSafeContent(unsafeRawHtml(`<div class="gb-wrapper">${this.renderVnSection()}</div>`, 'legacy Panel.setContent() migration'));
  }

  private renderIndex(data: ListFuelPricesResponse): void {
    if (!data.countries?.length) {
      if (this.vnRows.length > 0) {
        this.renderVnOnly();
        return;
      }
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
      return;
    }

    const sorted = [...data.countries].sort((a, b) => {
      const aPrice = a.gasoline?.usdPrice ?? 0;
      const bPrice = b.gasoline?.usdPrice ?? 0;
      return bPrice - aPrice;
    });

    const cheapestGas = data.cheapestGasoline ?? '';
    const priceiestGas = data.mostExpensiveGasoline ?? '';
    const cheapestDsl = data.cheapestDiesel ?? '';
    const priciestDsl = data.mostExpensiveDiesel ?? '';

    const showWow = data.wowAvailable;

    const rows = sorted.map(c => {
      const gas = c.gasoline;
      const dsl = c.diesel;

      function fuelCell(fuel: typeof gas, cheapCode: string, priceyCode: string, code: string): string {
        if (!fuel?.usdPrice) return `<td class="gb-cell gb-na">N/A</td>`;
        const cls = code === cheapCode ? 'gb-cheapest' : code === priceyCode ? 'gb-priciest' : '';
        let wowStr = '';
        if (showWow && fuel.wowPct != null && fuel.wowPct !== 0) {
          const sign = fuel.wowPct >= 0 ? '▲' : '▼';
          const wowCls = fuel.wowPct >= 0 ? 'bm-wow-up' : 'bm-wow-down';
          wowStr = ` <span class="${wowCls}">${sign}${Math.abs(fuel.wowPct).toFixed(1)}%</span>`;
        }
        return `<td class="gb-cell ${cls}">$${fuel.usdPrice.toFixed(3)}${wowStr}</td>`;
      }

      return `<tr>
        <td class="gb-item-name">${escapeHtml(c.flag)} ${escapeHtml(c.name)}</td>
        ${fuelCell(gas, cheapestGas, priceiestGas, c.code)}
        ${fuelCell(dsl, cheapestDsl, priciestDsl, c.code)}
      </tr>`;
    }).join('');

    const updatedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString() : '';
    const countLabel = data.countryCount ? ` (${data.countryCount} ${t('components.fuelPrices.countries')})` : '';

    const html = `
      <div class="gb-wrapper">
        <div class="gb-scroll">
          <table class="gb-table">
            <thead><tr>
              <th scope="col" class="gb-item-col">${t('panels.fuelPricesCountry')}</th>
              <th scope="col" class="gb-cell">${t('panels.fuelPricesGasoline')}</th>
              <th scope="col" class="gb-cell">${t('panels.fuelPricesDiesel')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${updatedAt ? `<div class="gb-updated">${t('components.status.updatedAt', { time: updatedAt })}${countLabel}</div>` : ''}
        ${this.renderVnSection()}
      </div>
    `;

    this.setSafeContent(unsafeRawHtml(html, 'legacy Panel.setContent() migration'));
  }

  /** Petrolimex retail board — fork PR-2d; absent when the VN source is down. */
  private renderVnSection(): string {
    if (this.vnRows.length === 0) return '';
    const rows = this.vnRows.map(r => `<tr>
        <td class="gb-item-name">${escapeHtml(r.product)}</td>
        <td class="gb-cell">${r.zone1VndPerLiter.toLocaleString()}</td>
        <td class="gb-cell">${r.zone2VndPerLiter.toLocaleString()}</td>
      </tr>`).join('');
    const asOf = this.vnRows.find(r => r.lastModified !== null)?.lastModified ?? null;
    const asOfText = asOf ? ` · ${new Date(asOf).toLocaleDateString()}` : '';
    return `
      <div class="gb-wrapper" style="margin-top:8px">
        <div class="fx-section-title">${t('components.fuelPrices.vnTitle')}</div>
        <div class="gb-scroll">
          <table class="gb-table">
            <thead><tr>
              <th scope="col" class="gb-item-col">${t('components.fuelPrices.vnProduct')}</th>
              <th scope="col" class="gb-cell">${t('components.fuelPrices.vnZone1')}</th>
              <th scope="col" class="gb-cell">${t('components.fuelPrices.vnZone2')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="gb-updated">${t('components.fuelPrices.vnSource')}${asOfText}</div>
        <div class="gb-updated">${t('components.vnData.licenseNote')}</div>
      </div>
    `;
  }
}
