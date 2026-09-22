// test/pages/portfolio.test.tsx — Portfolio dari fixture ChainContext (client.readContract di-inject, tanpa jaringan): tanpa akun → CTA connect
// tanpa angka; akun terhubung → saldo aset per pool, share × NAV/share = nilai, allowance, posisi dengan nilai close on-demand (`quoteClose(id, posisi)`
// per posisi terbuka, penjaga urutan, revert terdekode), klaim tersedia setelah settle, riwayat sendiri (who === account, case-insensitive), tautan explorer.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { POOLS, POOL_KEYS, explorerAddress, explorerTx } from '@chain/deployment';
import type { Client } from '@chain/chain/client';
import { seriesLabel } from '@chain/chain/trade';
import { shortAddr, shortHash, usdg, usdg6, wad } from '@chain/ui/format';
import Portfolio, { ownTrades } from '@/pages/Portfolio';
import { poolView, userView } from '@/chain/selectors';
import { DEFAULT_TRADE_POOL } from '@/lib/boards';
import { tradeHref } from '@/lib/route';
import { lpValue, positionKey } from '@/lib/trade';
import { Providers, renderWithChain } from '../render';
import { OWNER, USER, chainState, liveSnapshot, withSettled, withUser } from '../fixtures/snapshot';
import { liveEvents } from '../fixtures/events';

const readContract = vi.fn();
const client = { readContract } as unknown as Client;
const ASSET_SCALE = 10n ** 12n;
/** quoteClose(id, units) stub: proceeds = units dalam 6 dp (5 unit → 5.000000), σ dan spot dummy. */
const quoteClose = async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
  if (functionName !== 'quoteClose') throw new Error(`unexpected readContract ${functionName}`);
  return [args[1]! / ASSET_SCALE, 600_000_000_000_000_000n, 2_579n * 10n ** 18n] as const;
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.positions-table tbody tr'));
const cells = (tr: HTMLElement) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent!.trim());
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

beforeEach(() => { readContract.mockReset().mockImplementation(quoteClose); });
afterEach(() => { cleanup(); window.location.hash = ''; });

describe('Portfolio — no account', () => {
  it('shows the connect CTA and no numbers; the button calls connect(); without an injected wallet the CTA explains read-only', () => {
    const connect = vi.fn(async () => {});
    const { container, unmount } = renderWithChain(<Portfolio />, { snapshot: liveSnapshot(), hasWallet: true, connect, client });
    expect(screen.getByRole('heading', { level: 2, name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByText('Connect a wallet to see your portfolio')).toBeInTheDocument();
    expect(container.querySelector('.balance-card')).toBeNull();
    expect(container.querySelector('.positions-table')).toBeNull();
    expect(container.querySelector('.balance-value')).toBeNull();
    const cta = screen.getByText('Connect a wallet to see your portfolio').closest<HTMLElement>('.empty-state')!;
    fireEvent.click(within(cta).getByRole('button', { name: /Connect wallet/ }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(readContract).not.toHaveBeenCalled();
    unmount();
    renderWithChain(<Portfolio />, { snapshot: liveSnapshot(), hasWallet: false, client });
    expect(screen.getByText(/No injected wallet found — install MetaMask/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect wallet/ })).toBeNull();
    expect(screen.getByText('read-only · no wallet')).toBeInTheDocument();
  });

  it('account known but the snapshot has no user yet: cards carry the reason, no digits', () => {
    const { container } = renderWithChain(<Portfolio />, { snapshot: liveSnapshot(), account: USER, hasWallet: true, client });
    expect(container.querySelectorAll('.balance-card')).toHaveLength(POOL_KEYS.length);
    expect(screen.getAllByText('Reading your balances').length).toBeGreaterThanOrEqual(POOL_KEYS.length);
    for (const v of Array.from(container.querySelectorAll('.balance-value'))) expect(v.textContent).not.toMatch(/\d/);
    expect(screen.getByLabelText('Connected account')).toHaveTextContent(shortAddr(USER));
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe('Portfolio — connected account', () => {
  it('balances per pool (asset label), LP shares × NAV/share = value, allowance state, positions with quoteClose(id, units) read on demand', async () => {
    const s = withUser(liveSnapshot());
    const u = s.user!;
    const { container } = renderWithChain(<Portfolio />, { snapshot: s, hasWallet: true, client });
    await flush();
    const account = screen.getByLabelText('Connected account');
    expect(account).toHaveTextContent(USER);
    expect(within(account).getByRole('link', { name: /Arbiscan/ })).toHaveAttribute('href', explorerAddress(USER));
    expect(within(account).getByRole('link', { name: /^Trade/ })).toHaveAttribute('href', tradeHref(DEFAULT_TRADE_POOL));
    for (const k of POOL_KEYS) {
      const card = screen.getByLabelText(`Pool ${k} balances`);
      const pool = poolView(s, k);
      expect(within(card).getByText(usdg(u.asset[k]))).toBeInTheDocument();
      expect(card).toHaveTextContent(`Wallet balance of ${POOLS[k].assetSymbol}${POOLS[k].faucet === 'paxos' ? ' (Paxos)' : ' (mock)'}`);
      expect(within(card).getByText(usdg6(u.shares[k]))).toBeInTheDocument();
      expect(within(card).getByText(pool.navPerShare!.toFixed(6))).toBeInTheDocument();
      expect(within(card).getByText(`${usdg(lpValue(u.shares[k], pool)!)} ${POOLS[k].assetSymbol}`)).toBeInTheDocument();
      expect(within(card).getByText('approved')).toBeInTheDocument();
      expect(within(card).getByRole('link', { name: new RegExp(`Trade on ${k}`) })).toHaveAttribute('href', tradeHref(k));
      expect(within(card).getByRole('link', { name: /asset on Arbiscan/ })).toHaveAttribute('href', explorerAddress(POOLS[k].asset));
    }
    // LP value = shares × totalAssets / totalSupply in bigint (fixture A: 1e12 shares × NAV 1,000,102.510411 / 1e12 supply).
    expect(lpValue(u.shares.A, poolView(s, 'A'))).toBe(s.pools.A.totalAssets);
    // Positions: one row per PositionView, quoteClose(id, units) per open position, value = usdg6(proceeds).
    const positions = userView(s, USER)!.positions;
    expect(rows()).toHaveLength(positions.length);
    expect(screen.getByText(`${positions.length} positions`)).toBeInTheDocument();
    expect(readContract).toHaveBeenCalledTimes(positions.length);
    for (const p of positions) {
      // Pinned to the snapshot block (the footnote says "read on demand at the snapshot block").
      expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS[p.k].pool, functionName: 'quoteClose', args: [p.ref.id[p.k], p.units], blockNumber: s.blockNumber }));
      const tr = container.querySelector<HTMLElement>(`tr[data-position="${positionKey(p)}"]`)!;
      expect(tr).toHaveAttribute('data-status', 'open');
      expect(cells(tr).slice(0, 6)).toEqual([p.k, seriesLabel(p.ref), wad(p.units, 2), 'open', `${usdg6(p.units / ASSET_SCALE)} ${POOLS[p.k].assetSymbol}`, '—']);
      expect(within(tr).getByRole('link', { name: 'Close on Trade' })).toHaveAttribute('href', tradeHref(p.k, p.i));
    }
    // Per-pool position summary and no claimable before settlement.
    const held = positions.filter((p) => p.k === 'A');
    expect(screen.getByLabelText('Pool A balances')).toHaveTextContent(`${held.length} series · ${wad(held.reduce((a, p) => a + p.units, 0n), 2)} units`);
  });

  it('settled board: claimable = units × payoutPerUnit / 1e18 / 1e12 per position and per pool; no quoteClose for settled positions', async () => {
    const s = withUser(withSettled(liveSnapshot(), 0, 2900));
    const { container } = renderWithChain(<Portfolio />, { snapshot: s, hasWallet: true, client });
    await flush();
    const positions = userView(s, USER)!.positions;
    expect(positions.every((p) => p.settled)).toBe(true);
    expect(readContract).not.toHaveBeenCalled();
    for (const p of positions) {
      const tr = container.querySelector<HTMLElement>(`tr[data-position="${positionKey(p)}"]`)!;
      expect(tr).toHaveAttribute('data-status', 'settled');
      expect(cells(tr)[5]).toBe(`${usdg6(p.claimable)} ${POOLS[p.k].assetSymbol}`);
      expect(cells(tr)[4]).toBe(`settled — claim ${usdg6(p.claimable)} ${POOLS[p.k].assetSymbol}`);
      expect(within(tr).getByRole('link', { name: 'Claim on Trade' })).toHaveAttribute('href', tradeHref(p.k, p.i));
    }
    const c2800 = positions.find((p) => p.k === 'A' && p.ref.strike === 2800 && p.ref.isCall)!;
    expect(usdg6(c2800.claimable)).toBe('500.000000');
    const perPool = positions.filter((p) => p.k === 'A').reduce((a, p) => a + p.claimable, 0n);
    expect(screen.getByLabelText('Pool A balances')).toHaveTextContent(`Claimable payouts${usdg6(perPool)} USDG`);
  });

  it('a reverting quoteClose shows the decoded error for that position only; a late reply from an older snapshot never overwrites the newer value', async () => {
    const s = withUser(liveSnapshot());
    const positions = userView(s, USER)!.positions;
    const first = positions[0]!;
    readContract.mockImplementation(async (call: { functionName: string; args: readonly bigint[]; address: Address }) => {
      if (call.args[0] === first.ref.id[first.k] && call.address === POOLS[first.k].pool) throw new Error('quoteClose reverted (stub)');
      return quoteClose(call);
    });
    const state = chainState({ snapshot: s, hasWallet: true, client });
    const { container, rerender } = renderWithChain(<Portfolio />, state);
    await flush();
    expect(cells(container.querySelector<HTMLElement>(`tr[data-position="${positionKey(first)}"]`)!)[4]).toBe('quoteClose reverted (stub)');
    for (const p of positions.slice(1)) expect(cells(container.querySelector<HTMLElement>(`tr[data-position="${positionKey(p)}"]`)!)[4]).toBe(`${usdg6(p.units / ASSET_SCALE)} ${POOLS[p.k].assetSymbol}`);
    // Sequence guard: snapshot 2 answers late (deferred), snapshot 3 answers first → the cell shows snapshot 3's value and keeps it.
    const late = deferred<readonly [bigint, bigint, bigint]>();
    readContract.mockImplementation(async () => late.promise);
    rerender(<Providers state={chainState({ snapshot: withUser(liveSnapshot()), hasWallet: true, client })}><Portfolio /></Providers>);
    readContract.mockImplementation(async ({ args }: { args: readonly bigint[] }) => [args[1]! / ASSET_SCALE * 3n, 0n, 0n] as const);
    rerender(<Providers state={chainState({ snapshot: withUser(liveSnapshot()), hasWallet: true, client })}><Portfolio /></Providers>);
    await flush();
    const target = container.querySelector<HTMLElement>(`tr[data-position="${positionKey(first)}"]`)!;
    expect(cells(target)[4]).toBe(`${usdg6((first.units / ASSET_SCALE) * 3n)} ${POOLS[first.k].assetSymbol}`);
    await act(async () => { late.resolve([1n, 0n, 0n]); await Promise.resolve(); });
    expect(cells(target)[4]).toBe(`${usdg6((first.units / ASSET_SCALE) * 3n)} ${POOLS[first.k].assetSymbol}`);
  });

  it('own history = events.trades with who === account (case-insensitive), newest first, with explorer links; empty state otherwise', async () => {
    const s = withUser(liveSnapshot());
    const events = liveEvents();
    const mine = ownTrades(events.trades, USER);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(events.trades.length);
    expect(ownTrades(events.trades, USER.toLowerCase() as Address)).toEqual(mine);
    expect(mine.every((t) => t.who === USER)).toBe(true);
    expect(events.trades.some((t) => t.who === OWNER)).toBe(true);
    const { container } = renderWithChain(<Portfolio />, { snapshot: s, hasWallet: true, client, events, eventsState: 'live' });
    await flush();
    const panel = screen.getByLabelText('Your history');
    expect(within(panel).getByText('Live')).toBeInTheDocument();
    const trs = Array.from(panel.querySelectorAll<HTMLElement>('tbody tr'));
    expect(trs).toHaveLength(mine.length);
    trs.forEach((tr, n) => {
      const t = mine[n]!;
      expect(cells(tr)).toEqual([t.kind, t.pool, t.label, t.amount, t.block.toString(), `${shortHash(t.tx)} ↗`]);
      expect(within(tr).getByRole('link')).toHaveAttribute('href', explorerTx(t.tx));
    });
    expect(container.textContent).not.toContain(shortAddr(OWNER));
    cleanup();
    renderWithChain(<Portfolio />, { snapshot: s, hasWallet: true, client, events: { trades: [], observed: [] }, eventsState: 'scanning' });
    expect(screen.getByText('Scanning the chain for your events…')).toBeInTheDocument();
  });

  it('a wallet without option units shows the empty positions state and reads no quote', async () => {
    const s = withUser(liveSnapshot(), { positions: [] });
    renderWithChain(<Portfolio />, { snapshot: s, hasWallet: true, client });
    await flush();
    expect(screen.getByText('No option units in this wallet')).toBeInTheDocument();
    expect(screen.getByText('0 positions')).toBeInTheDocument();
    expect(readContract).not.toHaveBeenCalled();
  });
});
