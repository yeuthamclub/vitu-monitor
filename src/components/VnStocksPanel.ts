import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';
import type { SafeHtml } from '@/utils/sanitize';

import {
  degradedVnStocksSources,
  toVnStockIndexRows,
  toVnStockQuoteRows,
  type VnStocksPanelRows,
} from '@/services/economic/vn-stocks';

/**
 * VN Stocks panel — fork PR-2c.
 *
 * Two tabs over two on-demand seeded payloads:
 *
 * - **Indices** reads `vn:stock-indices:v1` (SSI iBoard: VNINDEX, VN30,
 *   HNXIndex) — the headline levels with day change and session turnover.
 * - **Tickers** reads `vn:stock-quotes:v1` (VPS board) — the HOSE blue-chip
 *   cohort (~VN30 superset) with price bands and matched volume.
 *
 * Both boards freeze at the close and republish the same close outside
 * trading, so values are last-quote, not stale by absence; a dead source is
 * named in the degraded notice rather than silently omitted (the FxPanel
 * pattern, #6199).
 */

export type VnStocksTabId = 'indices' | 'tickers';

const DEGRADED_RETRY_MS = 60_000;
const DEFAULT_TAB: VnStocksTabId = 'indices';

function changeClass(value: number): string {
  if (value > 0) return 'change-positive';
  if (value < 0) return 'change-negative';
  return 'fx-flat';
}

function formatPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** VN prices are quoted in đồng ×10 ("57.6" = 57,600 đồng). */
function formatPrice(value: number): string {
  return value.toFixed(2);
}

export class VnStocksPanel extends Panel {
  private indices: VnStocksPanelRows['indices'] = [];
  private tickers: VnStocksPanelRows['tickers'] = [];
  private degraded: VnStocksPanelRows['degraded'] = [];
  private tab: VnStocksTabId = DEFAULT_TAB;
  private tabForced = false;
  private loaded = false;
  private inFlight = false;
  private degradedRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      id: 'vn-stocks',
      title: t('panels.vn-stocks'),
      defaultRowSpan: 2,
    });
    this.content.addEventListener('click', (e) => this.handleClick(e));
  }

  public async fetchData(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { ensureHydrated } = await import('@/services/bootstrap');
      const [indicesPayload, quotesPayload] = await Promise.all([
        ensureHydrated('vnStockIndices').catch(() => undefined),
        ensureHydrated('vnStockQuotes').catch(() => undefined),
      ]);
      if (!this.element?.isConnected) return;
      this.indices = toVnStockIndexRows(indicesPayload);
      this.tickers = toVnStockQuoteRows(quotesPayload);
      this.degraded = degradedVnStocksSources({ indices: this.indices, tickers: this.tickers });
      this.loaded = true;
      this.render();
      this.scheduleDegradedRetry();
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleDegradedRetry(): void {
    this.clearDegradedRetry();
    if (this.degraded.length === 0) return;
    this.degradedRetryTimer = setTimeout(() => {
      this.degradedRetryTimer = null;
      if (!this.element?.isConnected) return;
      void this.fetchData();
    }, DEGRADED_RETRY_MS);
  }

  private clearDegradedRetry(): void {
    if (this.degradedRetryTimer !== null) {
      clearTimeout(this.degradedRetryTimer);
      this.degradedRetryTimer = null;
    }
  }

  public destroy(): void {
    this.clearDegradedRetry();
    super.destroy();
  }

  private handleClick(e: Event): void {
    const tab = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement | null;
    if (!tab?.dataset.tab) return;
    this.tab = tab.dataset.tab as VnStocksTabId;
    this.tabForced = false;
    this.render();
  }

  private render(): void {
    if (!this.loaded) return;

    // Both boards empty is an outage: three indices and ~30 blue chips are
    // never legitimately all absent. Surface the failure so retry schedules.
    if (this.indices.length === 0 && this.tickers.length === 0) {
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
      return;
    }

    // Never park the reader on an empty tab (the FxPanel fallback pattern).
    if (this.tabForced && this.tab !== DEFAULT_TAB && this.indices.length > 0) {
      this.tab = DEFAULT_TAB;
      this.tabForced = false;
    }
    if (this.tab === 'indices' && this.indices.length === 0) { this.tab = 'tickers'; this.tabForced = true; }
    if (this.tab === 'tickers' && this.tickers.length === 0) { this.tab = 'indices'; this.tabForced = true; }

    const body = this.tab === 'indices' ? this.renderIndices() : this.renderTickers();
    this.setSafeContent(safeHtml`${this.renderTabs()}${body}${this.renderDegradedNotice()}`);
  }

  private renderDegradedNotice(): SafeHtml {
    if (this.degraded.length === 0) return safeHtml``;
    const names = this.degraded.map((id) => t(`components.vnStocks.source.${id}`)).join(', ');
    return safeHtml`<div class="fx-degraded">${t('components.vnStocks.degraded', { sources: names })}</div>`;
  }

  private renderTabs(): SafeHtml {
    const tabs: SafeHtml[] = [];
    if (this.indices.length > 0) {
      tabs.push(safeHtml`<button class="panel-tab ${this.tab === 'indices' ? 'active' : ''}" data-tab="indices">${t('components.vnStocks.tabs.indices')}</button>`);
    }
    if (this.tickers.length > 0) {
      tabs.push(safeHtml`<button class="panel-tab ${this.tab === 'tickers' ? 'active' : ''}" data-tab="tickers">${t('components.vnStocks.tabs.tickers')}</button>`);
    }
    return safeHtml`<div class="panel-tabs">${joinSafeHtml(tabs)}</div>`;
  }

  private renderIndices(): SafeHtml {
    const asOf = this.indices.find((r) => r.time !== null)?.time ?? null;
    const rows = joinSafeHtml(this.indices.map((r) => safeHtml`
      <tr>
        <td class="fx-ccy"><span class="fx-ccy-code">${r.indexId}</span></td>
        <td>${r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
        <td class="${changeClass(r.change)}">${formatPct(r.changePct)}</td>
        <td>${r.advances === null || r.declines === null ? '--' : `${r.advances}↑ ${r.declines}↓`}</td>
      </tr>`));

    return safeHtml`
      <div class="fx-scroll">
        <table class="fx-table">
          <thead>
            <tr>
              <th scope="col" class="fx-ccy">${t('components.vnStocks.index')}</th>
              <th scope="col">${t('components.vnStocks.level')}</th>
              <th scope="col">${t('components.vnStocks.change')}</th>
              <th scope="col">${t('components.vnStocks.breadth')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="fx-footer">${t('components.vnStocks.source.indices')}${asOf ? ` · ${asOf}` : ''}</div>
      <div class="fx-footer">${t('components.vnData.licenseNote')}</div>`;
  }

  private renderTickers(): SafeHtml {
    const cell = (value: number | null, fmt: (v: number) => string) => (
      value === null ? safeHtml`<td class="fx-na">--</td>` : safeHtml`<td>${fmt(value)}</td>`
    );
    const rows = joinSafeHtml(this.tickers.map((r) => safeHtml`
      <tr>
        <td class="fx-ccy"><span class="fx-ccy-code">${r.symbol}</span></td>
        ${cell(r.last, formatPrice)}
        ${r.changePct === null
          ? safeHtml`<td class="fx-na">--</td>`
          : safeHtml`<td class="${changeClass(r.changePct)}">${formatPct(r.changePct)}</td>`}
        ${cell(r.ref, formatPrice)}
        ${cell(r.volume, (v) => v.toLocaleString())}
      </tr>`));

    return safeHtml`
      <div class="fx-scroll">
        <table class="fx-table">
          <thead>
            <tr>
              <th scope="col" class="fx-ccy">${t('components.vnStocks.symbol')}</th>
              <th scope="col">${t('components.vnStocks.last')}</th>
              <th scope="col">${t('components.vnStocks.change')}</th>
              <th scope="col">${t('components.vnStocks.ref')}</th>
              <th scope="col">${t('components.vnStocks.volume')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="fx-footer">${t('components.vnStocks.source.tickers')}</div>
      <div class="fx-footer">${t('components.vnData.licenseNote')}</div>`;
  }
}
