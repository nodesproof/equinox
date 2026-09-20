import { el, setText } from '../ui/dom';
import { relDiff, usdg6, wad, utc } from '../ui/format';
import { POOL_KEYS, type PoolKey } from '../deployment';
import type { Panel } from './types';
import type { ParityRow } from '../chain/parity';
import type { GasEstimate } from '../chain/gas';
import { atmSeries, type Snapshot } from '../chain/snapshot';

export interface BoardPanel extends Panel { setParity(rows: ParityRow[]): void; setGas(g: GasEstimate | null): void }

/** Papan seri: satu baris per seri (board × strike × C/P), kuotasi per pool di `POOL_KEYS` (Buy/Close/OI/σ per pool), Δ dan paritas K5 A vs B, satu baris gas A vs B. */
export function createBoard(): BoardPanel {
  const tbody = el('tbody');
  const gasLine = el('p', { class: 'muted small', text: 'gas: —' });
  const hasC = POOL_KEYS.includes('C');
  const note = el('p', { class: 'muted small' },
    'Quotes are per 1.0 unit at each pool\'s own inventory (σ_mark(util)); Δ is inventory, not math. ',
    'Parity ✓ = both math contracts (Solidity control vs Stylus) return byte-identical prices for identical inputs (S, K, t, σ_mark(0)) at this block — K5. ',
    'Gas = eth_estimateGas of buy(1 unit) from the seed-LP wallet; σ is computed by the shared engine, so the A/B difference is the two pricing calls (Stylus program cached). ',
    hasC ? 'Pool C: same Stylus math and engine as B, settled in Paxos USDG (testnet) — a much smaller pool, so its inventory term (σ_mark(util)) sits higher.' : null);
  // Kolom per pool dibangun dari POOL_KEYS; Δ dan Parity tetap A vs B (kontrol Solidity vs Stylus) — C memakai math yang sama dengan B.
  const heads = ['Board', 'K', 'C/P', ...POOL_KEYS.map((k) => `Buy ${k}`), 'Δ A|B', ...POOL_KEYS.map((k) => `Close ${k}`), 'Parity', ...POOL_KEYS.map((k) => `OI ${k}`), `σ_buy ${POOL_KEYS.join(' | ')}`];
  const root = el('section', {}, el('h2', { text: `Series board — Pool A (control) vs Pool B (Stylus)${hasC ? ` · Pool C (Stylus, real USDG)` : ''}` }),
    el('table', {}, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { class: i < 3 ? 'l' : '', text: h })))), tbody), gasLine, note);
  let parity: ParityRow[] = []; let gas: GasEstimate | null = null; let last: Snapshot | null = null;
  const k0: PoolKey = POOL_KEYS[0]!;
  const paint = () => {
    const s = last; if (!s) return;
    const atm = atmSeries(s);
    tbody.replaceChildren(...s.series.map((r) => {
      const p = parity.find((x) => x.ref.id.A === r.ref.id.A);
      const bA = r.A.buy, bB = r.B.buy, b0 = r[k0].buy;
      // Status menggantikan kuotasi pool pertama bila tidak ada: settled (payout WAD → 6 dp), blackout T_MIN = 60 s, atau nama revert.
      const status = r[k0].settled ? `settled @ ${usdg6(r[k0].payoutPerUnit / 10n ** 12n)}/unit` : r.ref.expiry <= s.blockTime + 60 ? 'blackout/expired' : r[k0].buyError ?? '';
      const cell = (t: string, cls = '') => el('td', { class: cls, text: t });
      // Pool selain yang pertama: kuotasi, atau '—' bila pool pertama punya kuotasi tetapi pool ini tidak (mis. revert khusus pool itu).
      const buyCell = (k: PoolKey) => (k === k0 ? cell(b0 ? usdg6(b0.premium) : status, 'mono') : cell(r[k].buy ? usdg6(r[k].buy!.premium) : (b0 ? '—' : ''), 'mono'));
      return el('tr', { class: atm && atm.ref.id.A === r.ref.id.A ? 'atm' : '' },
        cell(`#${r.ref.boardId} ${utc(r.ref.expiry)}`, 'l'), cell(String(r.ref.strike), 'l mono'), cell(r.ref.isCall ? 'C' : 'P', 'l'),
        ...POOL_KEYS.map(buyCell),
        cell(bA && bB ? (bA.premium === bB.premium ? '=' : relDiff(bA.premium, bB.premium)) : '', bA && bB && bA.premium === bB.premium ? 'ok' : 'muted'),
        ...POOL_KEYS.map((k) => cell(r[k].close !== null ? usdg6(r[k].close!) : '—', 'mono')),
        cell(p ? (p.ok === null ? '—' : p.ok ? '✓' : '✗') : '…', p && p.ok === false ? 'bad' : p && p.ok ? 'ok' : 'muted'),
        ...POOL_KEYS.map((k) => cell(wad(r[k].oi, 2), 'mono')),
        cell(POOL_KEYS.some((k) => r[k].buy) ? POOL_KEYS.map((k) => (r[k].buy ? wad(r[k].buy!.sigma) : '—')).join(' | ') : '', 'mono'));
    }));
    setText(gasLine, gas ? `gas buy(1 C ${gas.strike}, ${utc(gas.expiry)}): A ${gas.gas.A ?? '—'} · B ${gas.gas.B ?? '—'}${gas.gas.A && gas.gas.B ? ` · ratio ${(Number(gas.gas.A) / Number(gas.gas.B)).toFixed(2)}×` : ''}` : 'gas: —');
  };
  return { root, render(s) { last = s; paint(); }, setParity(rows) { parity = rows; paint(); }, setGas(g) { gas = g; paint(); } };
}
