import { el } from '../ui/dom';
import { feedUsd, fmtAge, fmtCountdown, pct, usdg, wad } from '../ui/format';
import { BOARDS, POOLS, POOL_KEYS, WAD, type PoolKey } from '../deployment';
import type { Panel } from './types';
import type { Snapshot } from '../chain/snapshot';

/** Header engine (σ_base, σ_mark(0), spot & umur round, countdown board) + dua kartu NAV A|B. */
export function createNav(): Panel {
  const engine = el('dl', { class: 'kv' });
  const cards = { A: el('dl', { class: 'kv' }), B: el('dl', { class: 'kv' }) } as Record<PoolKey, HTMLDListElement>;
  const root = el('section', {}, el('h2', { text: 'Volatility engine (shared) & NAV' }), engine,
    el('div', { class: 'grid2' }, ...POOL_KEYS.map((k) => el('div', {}, el('h2', { text: POOLS[k].label }), cards[k]))));
  const kv = (dl: HTMLDListElement, rows: [string, string][]) => dl.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })]));
  return { root, render(s, meta) {
    if (!s) return;
    const now = Math.floor(meta.nowMs / 1000);
    kv(engine, [
      ['Chainlink ETH/USD', `${feedUsd(s.feed.answer)} USD · ${fmtAge(now - s.feed.updatedAt)}`],
      ['σ_base (EWMA realized vol)', wad(s.vol.sigmaBase)], ['σ_mark(0) = σ_base × VRP', `${wad(s.vol.sigmaMark0)} (VRP ${wad(s.vol.vrp, 2)}, α ${wad(s.vol.alpha, 2)}, spread ${pct(s.vol.spread)})`],
      ...BOARDS.map((b): [string, string] => [`Board #${b.id} expiry`, `${new Date(b.expiry * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${b.expiry > now ? `in ${fmtCountdown(b.expiry - now)}` : s.pools.A.boards[b.id]?.settled ? `settled @ ${wad(s.pools.A.boards[b.id]!.settlementPrice, 2)} (A) / ${wad(s.pools.B.boards[b.id]!.settlementPrice, 2)} (B)` : 'expired — awaiting settle'}`]),
    ]);
    for (const k of POOL_KEYS) {
      const p = s.pools[k];
      // Rumus = kontrak: capForCaps = min(cash − escrow, capitalRefPrev) (`_capitalForCaps`, cash − escrow di-clamp 0 seperti `_capitalWad`),
      // vegaCap = capForCaps × 500 bps, util = netVega / vegaCap di-clamp [0, 1]; cap 0 → util 1 (`_util`). Semua WAD.
      const live = p.cash > p.escrow ? p.cash - p.escrow : 0n;
      const cap = live < p.capitalRefPrev ? live : p.capitalRefPrev;
      const vegaCap = cap * 500n / 10_000n;
      const util = vegaCap === 0n ? WAD : (p.netVega * WAD) / vegaCap;
      const liability = p.cash - p.escrow - p.totalAssets * 10n ** 12n;
      kv(cards[k], [
        ['NAV (totalAssets)', `${usdg(p.totalAssets)} USDG`], ['NAV / share', p.totalSupply === 0n ? '—' : (Number(p.totalAssets) / Number(p.totalSupply)).toFixed(6)],
        ['cash − escrow − MtM liability', `${usdg(p.cash / 10n ** 12n)} − ${usdg(p.escrow / 10n ** 12n)} − ${usdg(liability / 10n ** 12n)}`],
        ['reserved (Σ OI × K)', `${usdg(p.reserved / 10n ** 12n)} USDG`], ['free liquidity', `${usdg(p.freeLiquidity)} USDG`],
        ['net vega / util', `${wad(p.netVega, 1)} / ${pct(util > WAD ? WAD : util)} of cap ${wad(vegaCap, 0)}`], ['σ_mark(util)', wad(p.sigmaMarkNow)],
        ['capital reference (lagged)', `${usdg(p.capitalRefPrev / 10n ** 12n)} USDG`], ['trading paused', p.tradingPaused ? 'yes' : 'no'],
      ]);
    }
  } };
}
