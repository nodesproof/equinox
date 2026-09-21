// SeriesDetail.tsx — baris detail seri (Boards): Greeks 1 unit per pool dari `quoteBuy` snapshot (δ 2 dp, vega, σ efektif 4 dp, spot, premi + fee),
// close 1 unit, OI, dan harga math A/B dari baris paritas K5 (σ_mark(0), WAD) — tanpa perhitungan harga di klien. Tautan "Trade on k" per pool.
import type { CSSProperties } from 'react';
import { GAS_KEYS, POOLS, POOL_KEYS, type PoolKey } from '@chain/deployment';
import { relDiff, usdg6, wad } from '@chain/ui/format';
import { ASSET_SCALE, type SeriesStatus, type SeriesView } from '@/chain/selectors';
import { StatusPill, type PillTone } from '@/components/primitives';
import { buyCell, oiCell, parityCell } from '@/lib/boards';
import { wadExact } from '@/lib/format';
import { tradeHref } from '@/lib/route';

const STATUS_TONE: Record<SeriesStatus, PillTone> = { open: 'good', blackout: 'warn', expired: 'warn', settled: 'gold' };

/** Greeks satu pool: label → nilai; tanpa kuotasi → alasan (teks sel Buy) + OI/payout. */
function PoolGreeks({ r, k }: { r: SeriesView; k: PoolKey }) {
  const st = r.state[k], q = st.buy, status = r.status[k];
  const cell = buyCell(r, k);
  const symbol = POOLS[k].assetSymbol;
  return (
    <section className="series-detail__pool" aria-label={`Pool ${k} Greeks`}>
      <header className="series-detail__head">
        <strong>Pool {k}</strong>
        <StatusPill tone={STATUS_TONE[status]}>{status === 'expired' ? 'expired — awaiting settle' : status}</StatusPill>
      </header>
      {q ? (
        <dl className="greeks">
          <div><dt>δ delta</dt><dd>{wad(q.delta, 2)}</dd></div>
          <div><dt>vega / unit</dt><dd>{wad(q.vega, 4)}</dd></div>
          <div><dt>σ effective</dt><dd>{wad(q.sigma)}</dd></div>
          <div><dt>spot (quote)</dt><dd>{wad(q.spot, 2)} USD</dd></div>
          <div><dt>premium / unit</dt><dd>{usdg6(q.premium)} {symbol}</dd></div>
          <div><dt>fee / unit</dt><dd>{usdg6(q.fee)} {symbol}</dd></div>
          <div><dt>premium + fee</dt><dd>{usdg6(q.premium + q.fee)} {symbol}</dd></div>
          <div><dt>close / unit</dt><dd>{st.close !== null ? `${usdg6(st.close)} ${symbol}` : '—'}</dd></div>
          <div><dt>open interest</dt><dd>{oiCell(r, k)} units</dd></div>
        </dl>
      ) : (
        <dl className="greeks">
          <div className="greeks__wide"><dt>no buy quote</dt><dd className="greeks__reason" title={cell.name ?? undefined}>{cell.text}</dd></div>
          <div><dt>open interest</dt><dd>{oiCell(r, k)} units</dd></div>
          {st.settled ? <div><dt>payout / unit</dt><dd>{usdg6(st.payoutPerUnit / ASSET_SCALE)} {symbol}</dd></div> : null}
        </dl>
      )}
      <a className="soft-button" href={tradeHref(k, r.i)} title={`Open Trade with Pool ${k} and this series selected`}>Trade on {k}</a>
    </section>
  );
}

/** Blok paritas K5: harga math Solidity vs Stylus (σ_mark(0), WAD) dari `ParityRow` — dibandingkan tanpa toleransi di `readParity`.
 *  Bila ✗, harga ditampilkan WAD penuh (18 dp) agar selisih 1 wei pun terlihat — 6 dp akan menyembunyikannya. */
function ParityBlock({ r }: { r: SeriesView }) {
  const p = parityCell(r), row = r.parity;
  const price = (x: bigint | null) => (x === null ? '—' : p.state === 'bad' ? wadExact(x) : wad(x, 6));
  const verdict = p.state === 'pending' ? 'pending — reading both math contracts' : p.state === 'none' ? 'unavailable — series not live or a math call failed' : p.state === 'ok' ? 'byte-identical' : `mismatch · rel. diff ${row && row.priceSol !== null && row.priceStylus !== null ? relDiff(row.priceSol, row.priceStylus) : '—'}`;
  return (
    <section className="series-detail__parity" aria-label="K5 math parity">
      <header className="series-detail__head"><strong>K5 math parity</strong><span className="parity" data-parity={p.state}>{p.text}</span></header>
      <dl className="greeks">
        <div><dt>{GAS_KEYS[0]} Solidity</dt><dd>{price(row?.priceSol ?? null)}</dd></div>
        <div><dt>{GAS_KEYS[1]} Stylus</dt><dd>{price(row?.priceStylus ?? null)}</dd></div>
        <div className="greeks__wide"><dt>verdict</dt><dd className={p.state === 'bad' ? 'parity-bad' : undefined}>{verdict}</dd></div>
      </dl>
      <small>Both math contracts priced with the same (S, K, t, σ_mark(0)) at the snapshot block; pool quotes above differ by inventory (σ_mark(util)), never by math.</small>
    </section>
  );
}

export interface SeriesDetailProps { row: SeriesView }

export function SeriesDetail({ row }: SeriesDetailProps) {
  return (
    <div className="series-detail__inner series-detail__inner--pools" style={{ '--pools': POOL_KEYS.length } as CSSProperties}>
      {POOL_KEYS.map((k) => <PoolGreeks key={k} r={row} k={k} />)}
      <ParityBlock r={row} />
    </div>
  );
}
