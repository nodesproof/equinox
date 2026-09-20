import { el, setText } from '../ui/dom';
import { relDiff, usdg6, wad, utc } from '../ui/format';
import type { Panel } from './types';
import type { ParityRow } from '../chain/parity';
import type { GasEstimate } from '../chain/gas';
import { atmSeries, type Snapshot } from '../chain/snapshot';

export interface BoardPanel extends Panel { setParity(rows: ParityRow[]): void; setGas(g: GasEstimate | null): void }

/** Papan seri: 12 baris (2 board × 3 strike × C/P), kuotasi per pool, paritas K5 per baris, dan satu baris gas A vs B. */
export function createBoard(): BoardPanel {
  const tbody = el('tbody');
  const gasLine = el('p', { class: 'muted small', text: 'gas: —' });
  const note = el('p', { class: 'muted small' },
    'Quotes are per 1.0 unit at each pool\'s own inventory (σ_mark(util)); Δ is inventory, not math. ',
    'Parity ✓ = both math contracts (Solidity control vs Stylus) return byte-identical prices for identical inputs (S, K, t, σ_mark(0)) at this block — K5. ',
    'Gas = eth_estimateGas of buy(1 unit) from the seed-LP wallet; σ is computed by the shared engine, so the A/B difference is the two pricing calls (Stylus program cached).');
  const root = el('section', {}, el('h2', { text: 'Series board — Pool A (control) vs Pool B (Stylus)' }),
    el('table', {}, el('thead', {}, el('tr', {}, ...['Board', 'K', 'C/P', 'Buy A', 'Buy B', 'Δ', 'Close A', 'Close B', 'Parity', 'OI A', 'OI B', 'σ_buy A | B'].map((h, i) => el('th', { class: i < 3 ? 'l' : '', text: h })))), tbody), gasLine, note);
  let parity: ParityRow[] = []; let gas: GasEstimate | null = null; let last: Snapshot | null = null;
  const paint = () => {
    const s = last; if (!s) return;
    const atm = atmSeries(s);
    tbody.replaceChildren(...s.series.map((r) => {
      const p = parity.find((x) => x.ref.id.A === r.ref.id.A);
      const bA = r.A.buy, bB = r.B.buy;
      // Status menggantikan kuotasi A bila tidak ada: settled (payout WAD → 6 dp), blackout T_MIN = 60 s, atau nama revert.
      const status = r.A.settled ? `settled @ ${usdg6(r.A.payoutPerUnit / 10n ** 12n)}/unit` : r.ref.expiry <= s.blockTime + 60 ? 'blackout/expired' : r.A.buyError ?? '';
      const cell = (t: string, cls = '') => el('td', { class: cls, text: t });
      return el('tr', { class: atm && atm.ref.id.A === r.ref.id.A ? 'atm' : '' },
        cell(`#${r.ref.boardId} ${utc(r.ref.expiry)}`, 'l'), cell(String(r.ref.strike), 'l mono'), cell(r.ref.isCall ? 'C' : 'P', 'l'),
        cell(bA ? usdg6(bA.premium) : status, 'mono'), cell(bB ? usdg6(bB.premium) : (bB === null && bA ? '—' : ''), 'mono'),
        cell(bA && bB ? (bA.premium === bB.premium ? '=' : relDiff(bA.premium, bB.premium)) : '', bA && bB && bA.premium === bB.premium ? 'ok' : 'muted'),
        cell(r.A.close !== null ? usdg6(r.A.close) : '—', 'mono'), cell(r.B.close !== null ? usdg6(r.B.close) : '—', 'mono'),
        cell(p ? (p.ok === null ? '—' : p.ok ? '✓' : '✗') : '…', p && p.ok === false ? 'bad' : p && p.ok ? 'ok' : 'muted'),
        cell(wad(r.A.oi, 2), 'mono'), cell(wad(r.B.oi, 2), 'mono'),
        cell(bA && bB ? `${wad(bA.sigma)} | ${wad(bB.sigma)}` : '', 'mono'));
    }));
    setText(gasLine, gas ? `gas buy(1 C ${gas.strike}, ${utc(gas.expiry)}): A ${gas.gas.A ?? '—'} · B ${gas.gas.B ?? '—'}${gas.gas.A && gas.gas.B ? ` · ratio ${(Number(gas.gas.A) / Number(gas.gas.B)).toFixed(2)}×` : ''}` : 'gas: —');
  };
  return { root, render(s) { last = s; paint(); }, setParity(rows) { parity = rows; paint(); }, setGas(g) { gas = g; paint(); } };
}
