// PoolCard.tsx — satu kartu per pool di POOL_KEYS (Overview): NAV, NAV/share, free liquidity, meter utilisasi vega, cap dari `cfg()` bps,
// reserved/escrow/σ_mark(util)/net vega/fee, status paused, aset per pool (mock vs Paxos) — semua dari PoolView (selector), tidak ada konstanta.
import { memo } from 'react';
import { Link } from 'wouter';
import { ChevronRight, ExternalLink, Zap } from 'lucide-react';
import { POOLS, explorerAddress, type PoolKey } from '@chain/deployment';
import { pct, usdg, wad } from '@chain/ui/format';
import { ASSET_SCALE, type PoolView } from '@/chain/selectors';
import { EmptyValue, SkeletonLine, StatusPill } from '@/components/primitives';
import { bpsPct } from '@/lib/format';
import { tradeHref } from '@/lib/route';

/** Aksen kartu per pool: A (Solidity) emas, pool Stylus ungu. */
export const accent = (k: PoolKey) => (k === 'A' ? 'gold' : 'violet');
/** "Pool A — control (BlackScholesSol)" → "control (BlackScholesSol)". */
export const poolTagline = (k: PoolKey) => POOLS[k].label.split(' — ')[1] ?? POOLS[k].label;
/** Kalimat aset per pool (brief §7.1): mock dengan faucet terbuka, atau USDG Paxos asli (testnet). */
export const assetTagline = (k: PoolKey) => (POOLS[k].faucet === 'paxos' ? `${POOLS[k].assetSymbol} · Paxos (testnet)` : `${POOLS[k].assetSymbol} · mock, open faucet`);

export interface PoolCardProps {
  k: PoolKey;
  /** PoolView dari `usePools()`; null = belum ada snapshot (skeleton tanpa angka). */
  pool: PoolView | null;
  /** Alasan nilai kosong saat `pool` null. */
  emptyLabel?: string;
}

function PoolCardView({ k, pool, emptyLabel = 'Awaiting snapshot' }: PoolCardProps) {
  const tone = accent(k);
  const sym = POOLS[k].assetSymbol;
  const utilPct = pool ? Number(pool.util) / 1e16 : 0;
  return (
    <article className={`pool-card pool-card--${tone}`} aria-label={`Pool ${k}`} data-pool={k}>
      <div className="pool-card__top">
        <div className="pool-card__identity">
          <div className={`pool-orb pool-orb--${tone}`}>{k}</div>
          <div>
            <div className="pool-card__name">Pool {k} <span>{poolTagline(k)}</span></div>
            <a className="pool-card__math" href={explorerAddress(POOLS[k].asset)} target="_blank" rel="noopener noreferrer" title={`Asset ${POOLS[k].asset} on Arbiscan`}>{assetTagline(k)}</a>
          </div>
        </div>
        <div className="pool-card__pills">
          {pool?.tradingPaused ? <StatusPill tone="warn" title="tradingPaused() = true — buy/deposit revert TradingIsPaused; close, claim and withdraw still work">Trading paused</StatusPill> : null}
          <a className="icon-link" href={explorerAddress(POOLS[k].pool)} target="_blank" rel="noopener noreferrer" aria-label={`Open Pool ${k} on Arbiscan`} title={POOLS[k].pool}><ExternalLink size={15} /></a>
        </div>
      </div>
      <div className="pool-card__nav">
        <div>
          <span className="data-label">NAV (totalAssets)</span>
          <strong>{pool ? <>{usdg(pool.totalAssets)} <small>{sym}</small></> : <EmptyValue label={emptyLabel} />}</strong>
        </div>
        <div>
          <span className="data-label">Free liquidity</span>
          <strong>{pool ? <>{usdg(pool.freeLiquidity)} <small>{sym}</small></> : <EmptyValue label={emptyLabel} />}</strong>
        </div>
      </div>
      <div className="pool-card__meter">
        <div className="meter-heading"><span>Vega utilisation · netVega / vega cap</span><span className="mono">{pool ? pct(pool.util) : '—'}</span></div>
        <div className="meter-track" role="meter" aria-label={`Pool ${k} vega utilisation`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pool ? Math.round(utilPct * 100) / 100 : undefined}>
          <div className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, utilPct))}%` }} />
        </div>
        <div className="meter-foot">
          <span>Vega cap {pool ? `${wad(pool.vegaCap, 0)} (${bpsPct(pool.cfg.vegaCapBps)} of capital ref)` : '—'}</span>
          <span>Reserve {pool ? `${pct(pool.reserveUtil)} of cap ${usdg(pool.reserveCap / ASSET_SCALE)} (${bpsPct(pool.cfg.maxUtilBps)})` : '—'}</span>
        </div>
      </div>
      <dl className="pool-stats">
        <div><dt>NAV / share</dt><dd>{pool ? (pool.navPerShare === null ? '— (no shares)' : pool.navPerShare.toFixed(6)) : <SkeletonLine width={64} />}</dd></div>
        <div><dt>σ_mark(util)</dt><dd>{pool ? (pool.sigmaMarkNow === 0n ? '— (reverted)' : wad(pool.sigmaMarkNow)) : <SkeletonLine width={52} />}</dd></div>
        <div><dt>Reserved (Σ OI × K)</dt><dd>{pool ? `${usdg(pool.reserved / ASSET_SCALE)} ${sym}` : <SkeletonLine width={80} />}</dd></div>
        <div><dt>Escrowed payouts</dt><dd>{pool ? `${usdg(pool.escrow / ASSET_SCALE)} ${sym}` : <SkeletonLine width={72} />}</dd></div>
        <div><dt>Net vega</dt><dd>{pool ? wad(pool.netVega, 1) : <SkeletonLine width={48} />}</dd></div>
        <div><dt>Capital ref (lagged)</dt><dd>{pool ? `${usdg(pool.capitalRefPrev / ASSET_SCALE)} ${sym}` : <SkeletonLine width={80} />}</dd></div>
        <div><dt>Fee · min premium</dt><dd>{pool ? `${bpsPct(pool.cfg.feeBps)} · ${bpsPct(pool.cfg.minPremiumBps)} of K` : <SkeletonLine width={60} />}</dd></div>
        <div><dt>Cash (asset.balanceOf)</dt><dd>{pool ? `${usdg(pool.cash / ASSET_SCALE)} ${sym}` : <SkeletonLine width={80} />}</dd></div>
      </dl>
      <div className="pool-card__actions">
        <Link href="/boards" className="text-button">Inspect series <ChevronRight size={14} /></Link>
        <a href={tradeHref(k)} className="text-button">Trade on {k} <Zap size={13} /></a>
      </div>
    </article>
  );
}

/** Memo pada prop `pool` (identitas PoolView stabil per snapshot lewat usePools) — detak jam tidak merender ulang kartu. */
export const PoolCard = memo(PoolCardView);
