import { el, setText } from '../ui/dom';
import { shortHash, wad } from '../ui/format';
import { POOLS, explorerTx } from '../deployment';
import { polyline } from '../ui/svg';
import type { Panel } from './types';
import type { Events, TradeEvent } from '../chain/events';

export interface ActivityPanel extends Panel { setEvents(e: Events): void }
/** Baris tabel maksimum dan titik grafik maksimum (yang terbaru). */
export const MAX_ROWS = 30;
export const MAX_POINTS = 400;

const row = (t: TradeEvent) => el('tr', {},
  el('td', { class: 'l', title: POOLS[t.pool].label, text: t.pool }),
  el('td', { class: 'l', text: t.kind }),
  el('td', { class: 'l mono', text: t.label }),
  el('td', { class: 'l mono', text: t.amount }),
  el('td', { class: 'mono', text: t.block.toString() }),
  el('td', {}, el('a', { class: 'mono', href: explorerTx(t.tx), target: '_blank', rel: 'noopener', title: t.who ? `by ${t.who}` : undefined, text: `${shortHash(t.tx)} ↗` })),
);

/** Umpan aktivitas: kiri tabel event pool terbaru (kedua pool), kanan grafik σ_base dari `Observed` engine bersama. Digerakkan oleh `setEvents`, bukan snapshot. */
export function createActivity(): ActivityPanel {
  const tbody = el('tbody');
  const tableNote = el('p', { class: 'muted small', text: 'loading events…' });
  const chartBox = el('div', { class: 'chart-box' }, polyline([]));
  const chartNote = el('p', { class: 'muted small', text: 'loading observations…' });
  const root = el('section', {}, el('h2', { text: 'Activity — pool events (A | B) & σ_base history (shared engine)' }),
    el('div', { class: 'grid2' },
      el('div', {},
        el('table', {}, el('thead', {}, el('tr', {}, ...['Pool', 'Event', 'Series', 'Amount', 'Block', 'Tx'].map((h, i) => el('th', { class: i < 4 ? 'l' : '', text: h })))), tbody),
        tableNote),
      el('div', {}, chartBox, chartNote)));
  let events: Events | null = null;
  const paint = () => {
    if (!events) return;
    const rows = events.trades.slice(0, MAX_ROWS);
    tbody.replaceChildren(...rows.map(row));
    setText(tableNote, rows.length === 0 ? 'No pool events since deploy.' : events.trades.length > MAX_ROWS ? `Latest ${MAX_ROWS} of ${events.trades.length} events since deploy.` : `${events.trades.length} events since deploy.`);
    const obs = events.observed.slice(-MAX_POINTS);
    chartBox.replaceChildren(polyline(obs.map((o, i): [number, number] => [i, Number(o.sigmaBase) / 1e18])));
    const last = events.observed[events.observed.length - 1];
    setText(chartNote, last
      ? `${events.observed.length} observations since deploy${events.observed.length > MAX_POINTS ? ` (chart: latest ${MAX_POINTS})` : ''}; last σ_base ${wad(last.sigmaBase)} at block ${last.block} (ETH ${wad(last.priceWad, 2)} USD, Chainlink round …${last.roundId.toString().slice(-5)})`
      : 'No observations since deploy — the engine emits Observed only when a new Chainlink round is seen.');
  };
  return { root, render() {}, setEvents(e) { events = e; paint(); } };
}
