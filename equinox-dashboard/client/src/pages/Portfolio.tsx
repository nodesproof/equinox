// Portfolio.tsx — halaman Portfolio HIDUP untuk akun terhubung: saldo aset per pool (mock A/B, Paxos C), share LP × NAV/share = nilai, allowance
// per pool, posisi per seri dengan nilai close saat ini (`quoteClose(id, posisi)` dibaca ON-DEMAND dalam efek berkunci snapshot + posisi, DIPAKU ke
// blok snapshot (`blockNumber`) agar sesuai catatan kaki, penjaga urutan — bukan bagian snapshot) dan payout klaim, riwayat sendiri (`events.trades`
// dengan `who === account`), tautan Arbiscan.
// Tanpa akun → CTA connect tanpa satu angka pun; akun ada tetapi snapshot belum dibaca dengannya → kartu tanpa angka + alasan.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { ArrowUpRight, ExternalLink, History, Layers, Wallet } from 'lucide-react';
import { CHAIN_ID, POOLS, POOL_KEYS, explorerAddress, explorerTx, type PoolKey } from '@chain/deployment';
import type { Client } from '@chain/chain/client';
import type { TradeEvent } from '@chain/chain/events';
import type { SeriesRow } from '@chain/chain/snapshot';
import { decodeRevert } from '@chain/chain/wallet';
import { assetLabel, poolCall, seriesLabel } from '@chain/chain/trade';
import { shortAddr, shortHash, usdg, usdg6, wad } from '@chain/ui/format';
import { useChain } from '@/chain/provider';
import type { EventsState } from '@/chain/types';
import { useSnapshot } from '@/chain/useSnapshot';
import { useWallet } from '@/chain/useWallet';
import { useEvents } from '@/chain/useEvents';
import { seriesStatus, usePools, useUser, type PoolView, type PositionView, type UserView } from '@/chain/selectors';
import { NETWORK_NAME, WalletButton } from '@/components/Layout';
import { accent, assetTagline } from '@/components/PoolCard';
import { feedPill } from '@/components/EventsPreview';
import { Scroller } from '@/components/Scroller';
import { EmptyValue, SectionHeading, StatusPill } from '@/components/primitives';
import { DEFAULT_TRADE_POOL, STATUS_TONE, statusText } from '@/lib/boards';
import { tradeHref } from '@/lib/route';
import { ALLOWANCE_MIN_TEXT, lpValue, positionKey } from '@/lib/trade';

/** Nilai close on-demand satu posisi: `value` = proceeds `quoteClose(id, units)` (6 dp, indikatif), `error` = revert terdekode (mis. SeriesExpired). */
export interface CloseValue { value: bigint | null; error: string | null; loading: boolean }

/** Membaca `quoteClose(id, posisi)` untuk setiap posisi yang belum settle, sekali per (client, user, blockNumber) — user berganti setiap snapshot/akun.
 *  Dipaku ke `blockNumber` snapshot (eth_call `blockNumber`) sehingga nilai close = kuotasi pada blok yang sama dengan posisi/saldo yang ditampilkan
 *  (catatan kaki "read on demand at the snapshot block"); null (tanpa snapshot) → blok terbaru. Penjaga urutan: balasan dari efek yang lebih lama
 *  (snapshot sebelumnya / akun lain / unmount) dibuang. Nilai lama dipertahankan selama membaca ulang. */
export function useCloseValues(client: Client, user: UserView | null, blockNumber: bigint | null): Record<string, CloseValue> {
  const [values, setValues] = useState<Record<string, CloseValue>>({});
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const open = user ? user.positions.filter((p) => !p.settled) : [];
    setValues((prev) => Object.fromEntries(open.map((p) => { const key = positionKey(p); return [key, { value: prev[key]?.value ?? null, error: null, loading: true }]; })));
    for (const p of open) {
      const key = positionKey(p);
      client.readContract({ ...poolCall(p.k), functionName: 'quoteClose', args: [p.ref.id[p.k], p.units], ...(blockNumber === null ? {} : { blockNumber }) }).then(
        ([proceeds]) => { if (n === seq.current) setValues((v) => ({ ...v, [key]: { value: proceeds, error: null, loading: false } })); },
        (e: unknown) => { if (n === seq.current) setValues((v) => ({ ...v, [key]: { value: null, error: decodeRevert(e), loading: false } })); },
      );
    }
    return () => { seq.current++; };
  }, [client, user, blockNumber]);
  return values;
}

/** Riwayat sendiri (brief #64): Bought/Closed/Claimed dengan trader/holder = akun (Settled tidak punya pelaku). */
export const ownTrades = (trades: TradeEvent[], account: Address | null): TradeEvent[] =>
  (account ? trades.filter((t) => t.who !== null && t.who.toLowerCase() === account.toLowerCase()) : []);

function ConnectCta({ hasWallet }: { hasWallet: boolean }) {
  return (
    <article className="panel">
      <div className="empty-state empty-state--wide">
        <div className="empty-state__icon"><Wallet size={19} /></div>
        <strong>Connect a wallet to see your portfolio</strong>
        <span>Balances, LP shares, positions, claimable payouts and your own history are read for the connected address only — nothing is shown without one.</span>
        {hasWallet ? <WalletButton /> : <span>No injected wallet found — install MetaMask, add {NETWORK_NAME} (chain {CHAIN_ID}) and reload. The boards and quotes stay readable without a wallet.</span>}
      </div>
    </article>
  );
}

function AccountCard({ account, blockNumber, emptyLabel }: { account: Address; blockNumber: bigint | null; emptyLabel: string }) {
  return (
    <article className="panel account-card" aria-label="Connected account">
      <div className="account-card__top">
        <div className="account-avatar"><Wallet size={17} /></div>
        <div><div className="eyebrow">Connected account</div><strong className="mono">{shortAddr(account)}</strong></div>
      </div>
      <div className="account-address"><span>Address</span><span className="mono account-address__full">{account}</span></div>
      <div className="account-links">
        <a href={explorerAddress(account)} target="_blank" rel="noopener noreferrer" title={`${account} on Arbiscan`}>Arbiscan <ExternalLink size={11} /></a>
        <a href={tradeHref(DEFAULT_TRADE_POOL)}>Trade <ArrowUpRight size={11} /></a>
      </div>
      <p className="account-card__meta">{NETWORK_NAME} · {CHAIN_ID} · {blockNumber !== null ? `balances at block ${blockNumber}` : emptyLabel.toLowerCase()}</p>
    </article>
  );
}

/** Kartu per pool: saldo aset pool itu, share LP × NAV/share = nilai, allowance, jumlah posisi, klaim tersedia; tanpa `user` → tanpa angka. */
function BalanceCard({ k, pool, user, emptyLabel }: { k: PoolKey; pool: PoolView | null; user: UserView | null; emptyLabel: string }) {
  const symbol = POOLS[k].assetSymbol;
  const held = user ? user.positions.filter((p) => p.k === k) : [];
  const claimable = held.reduce((a, p) => a + p.claimable, 0n);
  const units = held.reduce((a, p) => a + p.units, 0n);
  const value = user && pool ? lpValue(user.user.shares[k], pool) : null;
  return (
    <article className={`balance-card pool-card pool-card--${accent(k)}`} aria-label={`Pool ${k} balances`} data-pool={k}>
      <div className="balance-card__head">
        <div className={`pool-orb pool-orb--${accent(k)}`}>{k}</div>
        <div><strong>Pool {k}</strong><span>{assetTagline(k)}</span></div>
        {user ? <StatusPill tone={user.approved[k] ? 'good' : 'warn'} title={user.approved[k] ? `allowance ≥ ${ALLOWANCE_MIN_TEXT} ${symbol}` : `allowance below ${ALLOWANCE_MIN_TEXT} ${symbol} — approve on the Trade page`}>{user.approved[k] ? 'approved' : 'not approved'}</StatusPill> : <StatusPill tone="muted">{emptyLabel}</StatusPill>}
      </div>
      <div className="balance-value">{user ? <>{usdg(user.user.asset[k])}<span> {symbol}</span></> : <EmptyValue label={emptyLabel} />}</div>
      <p>Wallet balance of {assetLabel(k)} — the asset of Pool {k}{POOLS[k].faucet === 'paxos' ? ' (testnet, faucet scale)' : ' (no real value)'}</p>
      <dl className="balance-rows">
        <div><dt>LP shares</dt><dd>{user ? usdg6(user.user.shares[k]) : <EmptyValue label={emptyLabel} />}</dd></div>
        <div><dt>NAV / share</dt><dd>{pool ? (pool.navPerShare === null ? '— (no shares)' : pool.navPerShare.toFixed(6)) : <EmptyValue label={emptyLabel} />}</dd></div>
        <div><dt>LP value (shares × NAV/share)</dt><dd>{user && pool ? (value === null ? '—' : `${usdg(value)} ${symbol}`) : <EmptyValue label={emptyLabel} />}</dd></div>
        <div><dt>Positions</dt><dd>{user ? (held.length ? `${held.length} series · ${wad(units, 2)} units` : '—') : <EmptyValue label={emptyLabel} />}</dd></div>
        <div><dt>Claimable payouts</dt><dd>{user ? (claimable > 0n ? `${usdg6(claimable)} ${symbol}` : '—') : <EmptyValue label={emptyLabel} />}</dd></div>
      </dl>
      <div className="balance-actions">
        <a className="soft-button" href={tradeHref(k)}>Trade on {k} <ArrowUpRight size={13} /></a>
        <a className="text-button" href={explorerAddress(POOLS[k].asset)} target="_blank" rel="noopener noreferrer" title={`Asset ${POOLS[k].asset} on Arbiscan`}>asset on Arbiscan <ExternalLink size={12} /></a>
      </div>
    </article>
  );
}

function PositionsPanel({ user, closeValues, blockTime, series, emptyLabel }: { user: UserView | null; closeValues: Record<string, CloseValue>; blockTime: number | null; series: SeriesRow[] | null; emptyLabel: string }) {
  const positions = user?.positions ?? [];
  const cell = (p: PositionView) => {
    const symbol = POOLS[p.k].assetSymbol;
    if (p.settled) return <span className="muted-text">settled — claim {usdg6(p.claimable)} {symbol}</span>;
    const cv = closeValues[positionKey(p)];
    if (!cv || (cv.loading && cv.value === null && cv.error === null)) return <span className="muted-text">…</span>;
    if (cv.value !== null) return <span className="mono" title={cv.loading ? 'Refreshing with the new snapshot…' : 'quoteClose(id, your units) — indicative'}>{usdg6(cv.value)} {symbol}</span>;
    return <span className="quote-status" title="quoteClose reverted">{cv.error}</span>;
  };
  return (
    <article className="panel positions-panel" aria-label="Positions">
      <div className="panel-header">
        <div><div className="eyebrow">Positions</div><h3>Option units you hold</h3></div>
        {user ? <StatusPill tone={positions.length ? 'good' : 'muted'}>{positions.length} {positions.length === 1 ? 'position' : 'positions'}</StatusPill> : <StatusPill tone="muted">{emptyLabel}</StatusPill>}
      </div>
      {positions.length && series && blockTime !== null ? (
        <Scroller>
          <table className="series-table positions-table">
            <thead><tr><th scope="col">Pool</th><th scope="col">Series</th><th scope="col">Units</th><th scope="col">Status</th><th scope="col">Close value now</th><th scope="col">Claimable</th><th scope="col" aria-label="Actions" /></tr></thead>
            <tbody>
              {positions.map((p) => {
                const status = seriesStatus(p.ref, series[p.i]![p.k], blockTime);
                return (
                  <tr key={positionKey(p)} className="series-row" data-position={positionKey(p)} data-status={status}>
                    <td><span className={`pool-orb pool-orb--${accent(p.k)} pool-orb--small`} aria-label={`Pool ${p.k}`}>{p.k}</span></td>
                    <td className="mono">{seriesLabel(p.ref)}</td>
                    <td className="mono">{wad(p.units, 2)}</td>
                    <td><StatusPill tone={STATUS_TONE[status]}>{statusText(status)}</StatusPill></td>
                    <td>{cell(p)}</td>
                    <td className="mono">{p.settled ? `${usdg6(p.claimable)} ${POOLS[p.k].assetSymbol}` : '—'}</td>
                    <td><span className="row-actions"><a className="soft-button" href={tradeHref(p.k, p.i)}>{p.settled ? 'Claim' : 'Close'} on Trade</a></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Scroller>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon"><Layers size={19} /></div>
          <strong>{user ? 'No option units in this wallet' : emptyLabel}</strong>
          <span>{user ? 'Buy a series on the Trade page — units appear here with their current close value and, after settlement, the claimable payout.' : 'Positions are read with the block-pinned snapshot for the connected account.'}</span>
        </div>
      )}
      <div className="board-panel__foot"><span>Close value = quoteClose(id, your units) read on demand at the snapshot block — indicative (view at the last observed round); the executed value and its slippage floor are simulated on the Trade page.</span></div>
    </article>
  );
}

function HistoryPanel({ trades, eventsState, account }: { trades: TradeEvent[]; eventsState: EventsState; account: Address }) {
  const pill = feedPill(eventsState, trades.length);
  return (
    <article className="panel history-panel" aria-label="Your history">
      <div className="panel-header">
        <div><div className="eyebrow">Your history</div><h3>Bought · Closed · Claimed by {shortAddr(account)}</h3></div>
        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
      </div>
      {trades.length ? (
        <Scroller>
          <table className="series-table history-table">
            <thead><tr><th scope="col">Kind</th><th scope="col">Pool</th><th scope="col">Series</th><th scope="col">Amount</th><th scope="col">Block</th><th scope="col">Tx</th></tr></thead>
            <tbody>
              {trades.map((t) => (
                <tr key={`${t.tx}:${t.logIndex}`} className="series-row" data-kind={t.kind}>
                  <td><strong>{t.kind}</strong></td>
                  <td><span className={`pool-orb pool-orb--${accent(t.pool)} pool-orb--small`} aria-label={`Pool ${t.pool}`}>{t.pool}</span></td>
                  <td className="mono">{t.label}</td>
                  <td className="mono">{t.amount}</td>
                  <td className="mono">{t.block.toString()}</td>
                  <td><a className="mono" href={explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" title={t.tx}>{shortHash(t.tx)} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon"><History size={19} /></div>
          <strong>{eventsState === 'live' ? 'No Bought, Closed or Claimed events from this address since deploy' : eventsState === 'scanning' ? 'Scanning the chain for your events…' : eventsState === 'error' ? 'Event scan failed — retrying at the next refresh' : 'No events loaded yet'}</strong>
          <span>Only events whose trader or holder is the connected address are listed (Settled has no actor); newest first, with explorer links.</span>
        </div>
      )}
    </article>
  );
}

export default function Portfolio() {
  const { snapshot, failed } = useSnapshot();
  const { account, hasWallet, wrongChain } = useWallet();
  const { client } = useChain();
  const user = useUser();
  const pools = usePools();
  const { trades, eventsState } = useEvents();
  const closeValues = useCloseValues(client, user, snapshot?.blockNumber ?? null);
  const mine = useMemo(() => ownTrades(trades, account), [trades, account]);
  const emptyLabel = failed ? 'RPC error — retrying' : account && snapshot && !user ? (wrongChain ? `Wrong network — switch to ${NETWORK_NAME}` : 'Reading your balances') : 'Awaiting snapshot';
  const poolOf = (k: PoolKey) => pools.find((p) => p.k === k) ?? null;

  return (
    <div className="page-stack">
      <SectionHeading eyebrow={`Portfolio · ${NETWORK_NAME}`} title="Portfolio"
        detail={`Balances, LP shares valued at NAV/share, option positions with their current close value and claimable payout, allowance per pool and your own history — all for the connected address, from the block-pinned snapshot. Every USDG figure names its pool: ${POOL_KEYS.map((k) => `${k} = ${assetLabel(k)}`).join(', ')}.`}
        action={<div className="trade-status">{account ? <StatusPill tone={wrongChain ? 'warn' : 'good'}>{wrongChain ? 'wrong network' : 'connected'}</StatusPill> : hasWallet ? null : <StatusPill tone="warn" title="No injected wallet found — the dashboard is read-only">read-only · no wallet</StatusPill>}{hasWallet ? <WalletButton /> : null}</div>} />
      {!account ? <ConnectCta hasWallet={hasWallet} /> : (
        <div className="portfolio-grid">
          <div className="portfolio-col">
            <AccountCard account={account} blockNumber={snapshot?.blockNumber ?? null} emptyLabel={emptyLabel} />
            {POOL_KEYS.map((k) => <BalanceCard key={k} k={k} pool={poolOf(k)} user={user} emptyLabel={emptyLabel} />)}
          </div>
          <div className="portfolio-col">
            <PositionsPanel user={user} closeValues={closeValues} blockTime={snapshot?.blockTime ?? null} series={snapshot?.series ?? null} emptyLabel={emptyLabel} />
            <HistoryPanel trades={mine} eventsState={eventsState} account={account} />
          </div>
        </div>
      )}
    </div>
  );
}
