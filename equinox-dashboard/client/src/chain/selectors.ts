// selectors.ts — turunan murni atas ChainState/Snapshot (rumus persis `web/src/panels/nav.ts` & predikat `board.ts`, brief §4.3/4.7/§3.5 #39),
// masing-masing dibungkus hook yang membaca useChain() dan di-memo per snapshot. Tidak ada angka kontrak yang hard-coded: bps dari `pools[k].cfg`.
import { useMemo } from 'react';
import type { Address } from 'viem';
import { ALL_SERIES, BOARDS, POOLS, POOL_KEYS, WAD, type Board, type PoolInfo, type PoolKey, type SeriesRef } from '@chain/deployment';
import { atmSeries, type PoolState, type SeriesRow, type SeriesState, type Snapshot, type UserState, type VolState } from '@chain/chain/snapshot';
import type { ParityRow } from '@chain/chain/parity';
import { ALLOWANCE_MIN } from '@chain/chain/trade';
import { useChain } from './provider';
import type { ChainState, Meta } from './types';

/** Aset 6 dp ↔ WAD (EquinoxPool.assetScale). */
export const ASSET_SCALE = 10n ** 12n;
/** Blackout kontrak: seri tidak bisa ditransaksikan bila `expiry ≤ blockTime + T_MIN` (EquinoxPool.T_MIN = 60 s). */
export const T_MIN = 60;

// ---------------------------------------------------------------- pool

export interface PoolDerived {
  /** totalAssets / totalSupply (keduanya 6 dp → rasio polos); null bila belum ada share. */
  navPerShare: number | null;
  /** MtM liability (WAD) = cash − escrow − NAV × 1e12 (brief §4.7). */
  liability: bigint;
  /** min(max(cash − escrow, 0), capitalRefPrev) — basis kedua cap (`_capitalForCaps`). */
  capForCaps: bigint;
  /** capForCaps × vegaCapBps / 10000 (WAD). */
  vegaCap: bigint;
  /** capForCaps × maxUtilBps / 10000 (WAD) — batas `reserved`; buy di atasnya revert UtilizationExceeded. */
  reserveCap: bigint;
  /** netVega / vegaCap di-clamp [0, 1] (WAD); cap 0 → 1 (`_util`). */
  util: bigint;
  /** reserved / reserveCap di-clamp [0, 1] (WAD); cap 0 → 1. */
  reserveUtil: bigint;
}
export type PoolView = PoolState & PoolDerived & { k: PoolKey; info: PoolInfo };

const clampWad = (x: bigint) => (x < 0n ? 0n : x > WAD ? WAD : x);
const ratio = (num: bigint, cap: bigint) => (cap === 0n ? WAD : clampWad((num * WAD) / cap));

/** Rumus = kontrak (nav.ts): live = max(cash − escrow, 0); cap = min(live, capitalRefPrev); vegaCap = cap × vegaCapBps; util = clamp(netVega / vegaCap). */
export function derivePool(p: PoolState): PoolDerived {
  const live = p.cash > p.escrow ? p.cash - p.escrow : 0n;
  const capForCaps = live < p.capitalRefPrev ? live : p.capitalRefPrev;
  const vegaCap = (capForCaps * BigInt(p.cfg.vegaCapBps)) / 10_000n;
  const reserveCap = (capForCaps * BigInt(p.cfg.maxUtilBps)) / 10_000n;
  return {
    navPerShare: p.totalSupply === 0n ? null : Number(p.totalAssets) / Number(p.totalSupply),
    liability: p.cash - p.escrow - p.totalAssets * ASSET_SCALE,
    capForCaps, vegaCap, reserveCap, util: ratio(p.netVega, vegaCap), reserveUtil: ratio(p.reserved, reserveCap),
  };
}
export function poolView(s: Snapshot, k: PoolKey): PoolView { return { k, info: POOLS[k], ...s.pools[k], ...derivePool(s.pools[k]) }; }

// ---------------------------------------------------------------- series & boards

/** Status seri per pool (board.ts / brief §3.5 #39): settled → 'settled'; expiry ≤ blockTime → 'expired' (menunggu settle);
 *  expiry ≤ blockTime + 60 → 'blackout'; selain itu 'open'. Waktu = blockTime (bukan jam dinding) karena menggerbangi aksi (brief §7.6). */
export type SeriesStatus = 'open' | 'blackout' | 'expired' | 'settled';
export function seriesStatus(ref: SeriesRef, st: SeriesState, blockTime: number): SeriesStatus {
  if (st.settled) return 'settled';
  if (ref.expiry <= blockTime) return 'expired';
  if (ref.expiry <= blockTime + T_MIN) return 'blackout';
  return 'open';
}
export interface SeriesView {
  /** Indeks global di ALL_SERIES — dipakai posisi pengguna (`user.positions[k][i]`) dan useTrade. */
  i: number;
  ref: SeriesRef;
  state: Record<PoolKey, SeriesState>;
  status: Record<PoolKey, SeriesStatus>;
  /** Baris paritas K5 (A vs B) untuk seri ini; null sebelum readParity pertama. */
  parity: ParityRow | null;
  /** Seri ATM (call terdekat spot pada board terbuka terdekat) — sorotan baris & counter gas. */
  atm: boolean;
}
export function seriesViews(s: Snapshot, parity: ParityRow[]): SeriesView[] {
  const atm = atmSeries(s);
  const byId = new Map(parity.map((p) => [p.ref.id.A, p]));
  return s.series.map((row: SeriesRow, i) => ({
    i, ref: row.ref,
    state: Object.fromEntries(POOL_KEYS.map((k) => [k, row[k]])) as Record<PoolKey, SeriesState>,
    status: Object.fromEntries(POOL_KEYS.map((k) => [k, seriesStatus(row.ref, row[k], s.blockTime)])) as Record<PoolKey, SeriesStatus>,
    parity: byId.get(row.ref.id.A) ?? null,
    atm: atm !== null && atm.ref.id.A === row.ref.id.A,
  }));
}

export type BoardStatus = 'open' | 'blackout' | 'expired' | 'settled';
export interface BoardView {
  board: Board;
  /** Status dari pool pertama (semua pool mendaftar board yang sama; settle per pool bisa berbeda beberapa blok) — nav.ts. */
  status: BoardStatus;
  /** Detik ke expiry dari blockTime (negatif bila lewat). */
  secondsToExpiry: number;
  /** Settle per pool: harga settlement (WAD) per pool, `settled` per pool. */
  settled: Record<PoolKey, { settled: boolean; settlementPrice: bigint }>;
  series: SeriesView[];
}
export function boardViews(s: Snapshot, parity: ParityRow[]): BoardView[] {
  const rows = seriesViews(s, parity);
  const k0 = POOL_KEYS[0]!;
  return BOARDS.map((board) => {
    const b0 = s.pools[k0].boards[board.id];
    const status: BoardStatus = b0?.settled ? 'settled' : board.expiry <= s.blockTime ? 'expired' : board.expiry <= s.blockTime + T_MIN ? 'blackout' : 'open';
    return {
      board, status, secondsToExpiry: board.expiry - s.blockTime,
      settled: Object.fromEntries(POOL_KEYS.map((k) => [k, s.pools[k].boards[board.id] ?? { settled: false, settlementPrice: 0n }])) as BoardView['settled'],
      series: rows.filter((r) => r.ref.boardId === board.id),
    };
  });
}

// ---------------------------------------------------------------- user

export interface PositionView {
  k: PoolKey; i: number; ref: SeriesRef;
  /** Unit yang dipegang (WAD). */
  units: bigint;
  settled: boolean;
  /** Payout per unit (WAD) — 0 sebelum settle. */
  payoutPerUnit: bigint;
  /** Payout klaim (aset 6 dp) = units × payoutPerUnit / 1e18 / 1e12 (brief §4.8); 0 bila belum settle. */
  claimable: bigint;
}
export interface UserView {
  user: UserState;
  /** allowance[k] ≥ ALLOWANCE_MIN (1 000 000 USDG) → tombol approve disembunyikan (trade.ts). */
  approved: Record<PoolKey, boolean>;
  /** Semua posisi > 0 di setiap pool, urut pool lalu seri. */
  positions: PositionView[];
}
/** `snapshot.user` hanya bila milik akun yang terhubung (snapshot lama bisa membawa akun sebelumnya) — predikat `user()` panel Trade klasik. */
export function userView(s: Snapshot | null, account: Address | null): UserView | null {
  if (!s || !account || !s.user || s.user.address.toLowerCase() !== account.toLowerCase()) return null;
  const u = s.user;
  const positions: PositionView[] = POOL_KEYS.flatMap((k) => ALL_SERIES.flatMap((ref, i) => {
    const units = u.positions[k][i] ?? 0n;
    if (units === 0n) return [];
    const st = s.series[i]![k];
    return [{ k, i, ref, units, settled: st.settled, payoutPerUnit: st.payoutPerUnit, claimable: (units * st.payoutPerUnit) / WAD / ASSET_SCALE }];
  }));
  return { user: u, approved: Object.fromEntries(POOL_KEYS.map((k) => [k, u.allowance[k] >= ALLOWANCE_MIN])) as Record<PoolKey, boolean>, positions };
}

// ---------------------------------------------------------------- engine

export interface EngineView {
  feed: Snapshot['feed'];
  vol: VolState;
  blockNumber: bigint;
  blockTime: number;
  /** Umur round Chainlink terakhir (detik, dari jam dinding `meta.nowMs`). */
  feedAgeS: number;
  /** Umur observasi engine terakhir (`lastTs`, detik). */
  lastObsAgeS: number;
  /** Umur blok snapshot (detik). */
  blockAgeS: number;
}
export function engineView(s: Snapshot, meta: Meta): EngineView {
  const now = Math.floor(meta.nowMs / 1000);
  return { feed: s.feed, vol: s.vol, blockNumber: s.blockNumber, blockTime: s.blockTime, feedAgeS: Math.max(0, now - s.feed.updatedAt), lastObsAgeS: Math.max(0, now - s.vol.lastTs), blockAgeS: Math.max(0, now - s.blockTime) };
}

// ---------------------------------------------------------------- banner

/** Teks banner brief §5 — hanya bila RPC gagal DAN masih ada data lama di layar; null selain itu. */
export function rpcBanner(state: Pick<ChainState, 'snapshot' | 'meta'>): string | null {
  if (state.meta.error === null || state.snapshot === null) return null;
  return `RPC unreachable — showing data fetched ${new Date(state.meta.lastOkMs ?? 0).toISOString().slice(11, 19)} UTC`;
}

// ---------------------------------------------------------------- hooks

/** PoolState + turunan nav.ts untuk pool k; null sebelum snapshot pertama. */
export function usePool(k: PoolKey): PoolView | null {
  const { snapshot } = useChain();
  return useMemo(() => (snapshot ? poolView(snapshot, k) : null), [snapshot, k]);
}
/** Semua pool di POOL_KEYS (urut manifest); [] sebelum snapshot pertama. */
export function usePools(): PoolView[] {
  const { snapshot } = useChain();
  return useMemo(() => (snapshot ? POOL_KEYS.map((k) => poolView(snapshot, k)) : []), [snapshot]);
}
/** Satu baris per seri ALL_SERIES dengan status per pool, paritas dan penanda ATM; [] sebelum snapshot pertama. */
export function useSeriesRows(): SeriesView[] {
  const { snapshot, parity } = useChain();
  return useMemo(() => (snapshot ? seriesViews(snapshot, parity) : []), [snapshot, parity]);
}
/** Satu entri per board manifest dengan seri-serinya; [] sebelum snapshot pertama. */
export function useBoards(): BoardView[] {
  const { snapshot, parity } = useChain();
  return useMemo(() => (snapshot ? boardViews(snapshot, parity) : []), [snapshot, parity]);
}
/** Data akun terhubung dari snapshot (null tanpa wallet / snapshot belum dibaca dengan akun ini). */
export function useUser(): UserView | null {
  const { snapshot, account } = useChain();
  return useMemo(() => userView(snapshot, account), [snapshot, account]);
}
/** Seri ATM (`atmSeries`): call terdekat spot pada board terbuka terdekat; null bila tidak ada board terbuka. */
export function useAtm(): SeriesRow | null {
  const { snapshot } = useChain();
  return useMemo(() => (snapshot ? atmSeries(snapshot) : null), [snapshot]);
}
/** Engine bersama + feed + umur (detak 1 s dari meta.nowMs); null sebelum snapshot pertama. */
export function useEngine(): EngineView | null {
  const { snapshot, meta } = useChain();
  return useMemo(() => (snapshot ? engineView(snapshot, meta) : null), [snapshot, meta]);
}
