// test/chain/selectors.test.ts — turunan murni (rumus nav.ts / predikat board.ts / brief §4) atas fixture Appendix C, plus hook-nya lewat ChainContext fixture.
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, POOLS, POOL_KEYS, WAD, type PoolKey } from '@chain/deployment';
import { atmSeries, type PoolState } from '@chain/chain/snapshot';
import { ALLOWANCE_MIN } from '@chain/chain/trade';
import { ChainContext } from '@/chain/provider';
import { boardViews, derivePool, engineView, poolView, rpcBanner, seriesStatus, seriesViews, useAtm, useBoards, useEngine, usePool, usePools, useSeriesRows, useUser, userView } from '@/chain/selectors';
import type { ChainState } from '@/chain/types';
import { BLOCK_TIME, CFG, USER, chainState, demoPositions, liveParity, liveSnapshot, withBlackout, withExpired, withOracleStale, withPaused, withSettled, withStale, withUser } from '../fixtures/snapshot';

const idx = (boardId: number, strike: number, isCall: boolean) => ALL_SERIES.findIndex((s) => s.boardId === boardId && s.strike === strike && s.isCall === isCall);
const SCALE = 10n ** 12n;

describe('derivePool (brief §4.3/4.7 — bps from cfg, never constants)', () => {
  it('pool A: capForCaps = min(cash − escrow, capitalRefPrev); vegaCap/reserveCap from cfg bps; util = netVega/vegaCap; liability; NAV/share', () => {
    const s = liveSnapshot(), p = s.pools.A, d = derivePool(p);
    expect(d.capForCaps).toBe(p.capitalRefPrev);                          // cash (1,000,122) > lagged reference (1,000,000)
    expect(d.vegaCap).toBe((p.capitalRefPrev * 500n) / 10_000n);           // 50,000 WAD
    expect(d.reserveCap).toBe((p.capitalRefPrev * 8000n) / 10_000n);       // 800,000 WAD
    expect(d.util).toBe((p.netVega * WAD) / d.vegaCap);                    // 2,100 / 50,000 = 4.2 %
    expect(Number(d.util) / 1e16).toBeCloseTo(4.2, 6);
    expect(d.reserveUtil).toBe((p.reserved * WAD) / d.reserveCap);
    expect(d.liability).toBe(p.cash - p.escrow - p.totalAssets * SCALE);   // 19.489589 USDG of MtM
    expect(d.liability).toBe(19_489_589n * SCALE);
    expect(d.navPerShare).toBeCloseTo(1.000102510411, 12);
    // bps datang dari cfg(): menggandakan vegaCapBps menggandakan vega cap — tidak ada 500/8000 yang tertanam di selector.
    const wide = derivePool({ ...p, cfg: { ...p.cfg, vegaCapBps: 1000, maxUtilBps: 4000 } });
    expect(wide.vegaCap).toBe(2n * d.vegaCap);
    expect(wide.reserveCap).toBe(d.reserveCap / 2n);
    expect(poolView(s, 'A')).toMatchObject({ k: 'A', info: POOLS.A, totalAssets: p.totalAssets, vegaCap: d.vegaCap });
  });
  it('clamps: cap 0 → util 1; netVega above cap → 1; cash < escrow → live 0 → cap 0', () => {
    const p: PoolState = liveSnapshot().pools.A;
    expect(derivePool({ ...p, capitalRefPrev: 0n }).util).toBe(WAD);
    expect(derivePool({ ...p, capitalRefPrev: 0n }).reserveUtil).toBe(WAD);
    expect(derivePool({ ...p, netVega: 10n ** 9n * WAD }).util).toBe(WAD);
    const under = derivePool({ ...p, escrow: p.cash + 1n });
    expect(under.capForCaps).toBe(0n); expect(under.vegaCap).toBe(0n); expect(under.util).toBe(WAD);
    expect(derivePool({ ...p, totalSupply: 0n }).navPerShare).toBeNull();
  });
  it('pool C (faucet scale, when listed): cap = live cash (< 100 USDG reference), util 0, NAV/share from 90 shares', () => {
    if (!POOL_KEYS.includes('C')) return;
    const p = liveSnapshot().pools.C, d = derivePool(p);
    expect(p.cash - p.escrow < p.capitalRefPrev).toBe(true);
    expect(d.capForCaps).toBe(p.cash - p.escrow);
    expect(d.vegaCap).toBe(((p.cash - p.escrow) * BigInt(CFG.vegaCapBps)) / 10_000n);
    expect(d.util).toBe(0n);
    expect(d.navPerShare).toBeCloseTo(90.264867 / 90, 9);
  });
});

describe('series & board status (board.ts predicates, brief §3.5 #39)', () => {
  it('live fixture: every series open on every pool, exactly one ATM row = atmSeries, parity attached, last series carries its revert name', () => {
    const s = liveSnapshot(), rows = seriesViews(s, liveParity(s));
    expect(rows).toHaveLength(ALL_SERIES.length);
    for (const r of rows) for (const k of POOL_KEYS) expect(r.status[k], `${k} #${r.i}`).toBe('open');
    const atm = rows.filter((r) => r.atm);
    expect(atm).toHaveLength(1);
    expect(atm[0]!.ref).toEqual(atmSeries(s)!.ref);
    expect(atm[0]!.ref).toMatchObject({ boardId: 0, strike: 2600, isCall: true });     // spot 2,579.49 → K 2600 nearest
    expect(rows.every((r) => r.parity !== null && r.parity.ok === true)).toBe(true);
    const last = rows[rows.length - 1]!;
    for (const k of POOL_KEYS) expect(last.state[k]).toMatchObject({ buy: null, buyError: 'SeriesExpired' });
    expect(rows[0]!.state.A.buy!.premium > 0n).toBe(true);
    expect(rows[0]!.state.A.buy!.fee).toBe((rows[0]!.state.A.buy!.premium * 300n + 9_999n) / 10_000n);
  });
  it('seriesStatus: settled beats expired beats blackout (≤ 60 s) beats open', () => {
    const ref = ALL_SERIES[0]!, st = liveSnapshot().series[0]!.A;
    expect(seriesStatus(ref, st, ref.expiry - 61)).toBe('open');
    expect(seriesStatus(ref, st, ref.expiry - 60)).toBe('blackout');
    expect(seriesStatus(ref, st, ref.expiry)).toBe('expired');
    expect(seriesStatus(ref, { ...st, settled: true }, ref.expiry - 61)).toBe('settled');
  });
  it('withBlackout(idx) puts that board in blackout, earlier boards expired, later boards open; quotes vanish with SeriesExpired', () => {
    const i = idx(1, 2600, true);
    const s = withBlackout(liveSnapshot(), i), rows = seriesViews(s, []), boards = boardViews(s, []);
    expect(s.blockTime).toBe(ALL_SERIES[i]!.expiry - 30);
    for (const r of rows) {
      const want = r.ref.boardId === 1 ? 'blackout' : r.ref.expiry < s.blockTime ? 'expired' : 'open';
      for (const k of POOL_KEYS) { expect(r.status[k], `${k} #${r.i}`).toBe(want); if (want !== 'open') expect(r.state[k]).toMatchObject({ buy: null, buyError: 'SeriesExpired', close: null }); }
    }
    expect(boards.find((b) => b.board.id === 1)!.status).toBe('blackout');
    expect(boards.find((b) => b.board.id === 0)!.status).toBe('expired');
    // Blackout pada board 0 tidak menyentuh board 1.
    const s0 = withBlackout(liveSnapshot(), idx(0, 2400, true));
    expect(boardViews(s0, []).map((b) => b.status)).toEqual(BOARDS.map((b) => (b.id === 0 ? 'blackout' : 'open')));
    expect(seriesViews(s0, []).find((r) => r.ref.boardId === 1)!.state.A.buy).not.toBeNull();
  });
  it('withExpired(0): board 0 "expired — awaiting settle" (not settled), board 1 open; atmSeries falls through to board 1', () => {
    const s = withExpired(liveSnapshot(), 0), boards = boardViews(s, []);
    expect(boards[0]).toMatchObject({ status: 'expired' });
    expect(boards[0]!.settled.A.settled).toBe(false);
    expect(boards[0]!.secondsToExpiry).toBeLessThan(0);
    expect(boards[1]!.status).toBe('open');
    expect(atmSeries(s)!.ref.boardId).toBe(1);
  });
  it('withSettled(0, 2900): payout per unit call min(max(S_T − K, 0), K) / put max(K − S_T, 0); escrow/reserved move; status settled per pool', () => {
    const s = withSettled(liveSnapshot(), 0, 2900), rows = seriesViews(s, []), boards = boardViews(s, []);
    const payout = (strike: number, isCall: boolean) => rows[idx(0, strike, isCall)]!.state.A.payoutPerUnit;
    expect(payout(2400, true)).toBe(500n * WAD); expect(payout(2600, true)).toBe(300n * WAD); expect(payout(2800, true)).toBe(100n * WAD);
    expect(payout(2400, false)).toBe(0n); expect(payout(2800, false)).toBe(0n);
    for (const r of rows.filter((r) => r.ref.boardId === 0)) for (const k of POOL_KEYS) {
      expect(r.status[k]).toBe('settled'); expect(r.state[k]).toMatchObject({ settled: true, buy: null, buyError: 'SeriesSettled', close: null });
    }
    expect(boards[0]).toMatchObject({ status: 'settled' });
    for (const k of POOL_KEYS) expect(boards[0]!.settled[k]).toEqual({ settled: true, settlementPrice: 2900n * WAD });
    // Posisi demo 5 × C 2800 di pool ber-mint: escrow += 5 × 100 USDG; reserved (5 × 2800 + 1 × 2400) dilepas → 0.
    for (const k of POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint')) {
      expect(s.pools[k].escrow).toBe(500n * WAD);
      expect(s.pools[k].reserved).toBe(0n);
      expect(s.pools[k].freeLiquidity).toBe((s.pools[k].cash - s.pools[k].escrow) / SCALE);
    }
    expect(boards[1]!.status).toBe('open');
  });
  it('withOracleStale: every open quote reverts OracleStale, feed older than heartbeat × staleMult; withPaused flips the flag only', () => {
    const s = withOracleStale(liveSnapshot());
    expect(s.blockTime - s.feed.updatedAt).toBeGreaterThan(CFG.heartbeat * CFG.staleMult);
    for (const r of s.series) for (const k of POOL_KEYS) expect(r[k]).toMatchObject({ buy: null, buyError: 'OracleStale', close: null });
    const p = withPaused(liveSnapshot(), 'B');
    expect(p.pools.B.tradingPaused).toBe(true); expect(p.pools.A.tradingPaused).toBe(false);
    expect(p.series[0]!.B.buy).not.toBeNull();
  });
});

describe('userView', () => {
  it('is null without snapshot / account / user, or when the snapshot user is another account (case-insensitive match)', () => {
    const s = withUser(liveSnapshot());
    expect(userView(null, USER)).toBeNull();
    expect(userView(liveSnapshot(), USER)).toBeNull();
    expect(userView(s, null)).toBeNull();
    expect(userView(s, '0x2222222222222222222222222222222222222222')).toBeNull();
    expect(userView(s, USER.toLowerCase() as `0x${string}`)).not.toBeNull();
  });
  it('lists positions > 0 with claimable payout after settlement; approved per pool from ALLOWANCE_MIN', () => {
    const live = userView(withUser(liveSnapshot()), USER)!;
    // Urutan userView: pool (POOL_KEYS) lalu indeks seri.
    const byPoolThenIndex = (a: { k: string; i: number }, b: { k: string; i: number }) => POOL_KEYS.indexOf(a.k as PoolKey) - POOL_KEYS.indexOf(b.k as PoolKey) || a.i - b.i;
    expect(live.positions.map(({ k, i, units }) => ({ k, i, units }))).toEqual([...demoPositions()].sort(byPoolThenIndex));
    for (const p of live.positions) { expect(p.settled).toBe(false); expect(p.claimable).toBe(0n); }
    for (const k of POOL_KEYS) expect(live.approved[k], `approved ${k}`).toBe(true);
    if (POOL_KEYS.includes('C')) expect(live.user.allowance.C < 2n ** 256n - 1n && live.user.allowance.C >= ALLOWANCE_MIN).toBe(true);
    const settled = userView(withUser(withSettled(liveSnapshot(), 0, 2900)), USER)!;
    const c2800 = settled.positions.find((p) => p.k === 'A' && p.i === idx(0, 2800, true))!;
    expect(c2800).toMatchObject({ settled: true, payoutPerUnit: 100n * WAD, claimable: 500_000_000n });   // 5 units × 100 USDG
    expect(settled.positions.find((p) => p.k === 'A' && p.i === idx(0, 2400, false))!.claimable).toBe(0n);
    const unapproved = userView(withUser(liveSnapshot(), { allowance: { A: ALLOWANCE_MIN - 1n }, positions: [] }), USER)!;
    expect(unapproved.approved.A).toBe(false); expect(unapproved.approved.B).toBe(true); expect(unapproved.positions).toEqual([]);
  });
});

describe('engineView & rpcBanner', () => {
  it('ages from meta.nowMs (feed round, last engine observation, block)', () => {
    const s = liveSnapshot();
    const v = engineView(s, { nowMs: (BLOCK_TIME + 100) * 1000, lastOkMs: 0, error: null, stale: false, refreshes: 1 });
    expect(v).toMatchObject({ feedAgeS: 138, blockAgeS: 100, lastObsAgeS: BLOCK_TIME + 100 - s.vol.lastTs, blockNumber: s.blockNumber });
    expect(v.vol.vrp).toBe(s.vol.vrp);
  });
  it('banner only when there is an error AND old data on screen; text carries the last-OK time in UTC', () => {
    const s = liveSnapshot();
    const meta = { nowMs: 0, lastOkMs: Date.UTC(2026, 8, 20, 13, 3, 7), error: 'HTTP request failed.', stale: true, refreshes: 1 };
    expect(rpcBanner({ snapshot: s, meta })).toBe('RPC unreachable — showing data fetched 13:03:07 UTC');
    expect(rpcBanner({ snapshot: null, meta })).toBeNull();
    expect(rpcBanner({ snapshot: s, meta: { ...meta, error: null } })).toBeNull();
  });
});

describe('hooks over a fixture ChainContext', () => {
  const wrap = (state: ChainState) => ({ children }: { children: ReactNode }) => createElement(ChainContext.Provider, { value: state }, children);
  it('usePool/usePools/useSeriesRows/useBoards/useAtm/useEngine read the snapshot; useUser follows the account', () => {
    const state = chainState({ snapshot: withUser(liveSnapshot()) });
    expect(state.account).toBe(USER);
    const { result } = renderHook(() => ({ a: usePool('A'), all: usePools(), rows: useSeriesRows(), boards: useBoards(), atm: useAtm(), eng: useEngine(), user: useUser() }), { wrapper: wrap(state) });
    expect(result.current.a!.vegaCap).toBe(derivePool(state.snapshot!.pools.A).vegaCap);
    expect(result.current.all.map((p) => p.k)).toEqual(POOL_KEYS);
    expect(result.current.rows).toHaveLength(ALL_SERIES.length);
    expect(result.current.rows.filter((r) => r.parity?.ok === true).length).toBeGreaterThan(0);
    expect(result.current.boards.map((b) => b.board.id)).toEqual(BOARDS.map((b) => b.id));
    expect(result.current.atm!.ref).toEqual(atmSeries(state.snapshot!)!.ref);
    expect(result.current.eng!.blockTime).toBe(BLOCK_TIME);
    expect(result.current.user!.positions).toHaveLength(demoPositions().length);
  });
  it('returns null/[] before the first snapshot, and chainState(withStale) yields stale meta with data kept', () => {
    const empty = chainState({ snapshot: null });
    const { result } = renderHook(() => ({ a: usePool('B' as PoolKey), rows: useSeriesRows(), boards: useBoards(), atm: useAtm(), eng: useEngine(), user: useUser() }), { wrapper: wrap(empty) });
    expect(result.current).toEqual({ a: null, rows: [], boards: [], atm: null, eng: null, user: null });
    const stale = chainState({ snapshot: withStale(liveSnapshot()) });
    expect(stale.meta.stale).toBe(true); expect(stale.meta.error).not.toBeNull(); expect(stale.snapshot).not.toBeNull();
    expect(rpcBanner(stale)).toMatch(/^RPC unreachable — showing data fetched \d\d:\d\d:\d\d UTC$/);
  });
});
