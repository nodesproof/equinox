// test/fixtures/snapshot.ts — snapshot sintetis dari nilai Appendix C brief (blok 310878195, 20 Sep 2026 13:03 UTC; HANYA untuk test, tidak pernah ditampilkan).
// Dibangun dari POOL_KEYS/ALL_SERIES/BOARDS nyata — tidak ada jumlah pool/board/seri yang hard-coded; mutator `with*` mengembalikan snapshot baru (immutable).
import type { Address } from 'viem';
import { ALL_SERIES, BOARDS, DEPLOYER, GAS_KEYS, POOLS, POOL_KEYS, WAD, type PoolKey, type SeriesRef } from '@chain/deployment';
import { atmSeries, type PoolCfg, type PoolState, type Quote, type SeriesRow, type SeriesState, type Snapshot, type UserState, type VolState } from '@chain/chain/snapshot';
import type { ParityRow } from '@chain/chain/parity';
import type { GasEstimate } from '@chain/chain/gas';
import type { Client } from '@chain/chain/client';
import { MAX_UINT } from '@chain/chain/trade';
import { STALE_MS, isStale } from '@chain/ui/poll';
import type { ChainState, Meta } from '@/chain/types';

// --- konstanta Appendix C ---
export const BLOCK = 310_878_195n;
/** 2026-09-20 13:03:00 UTC (38 s setelah round Chainlink 1789909342). */
export const BLOCK_TIME = 1_789_909_380;
export const FEED_ANSWER = 257_948_518_341n;            // 2 579.49 USD, 8 dp
export const FEED_UPDATED_AT = 1_789_909_342;
export const SPOT = Number(FEED_ANSWER) / 1e8;
/** Akun pengguna sintetis (checksum valid: hanya digit). */
export const USER: Address = '0x1111111111111111111111111111111111111111';
/** Owner/treasury pool di fixture = alamat deployer manifest (bukan literal baru). */
export const OWNER: Address = DEPLOYER;
const ASSET_SCALE = 10n ** 12n;
/** Desimal → WAD lewat 6 dp bulat (menghindari presisi float pada 1e18). */
const toWad = (x: number) => BigInt(Math.round(x * 1e6)) * ASSET_SCALE;
const to6 = (x: number, up: boolean) => BigInt(up ? Math.ceil(x * 1e6) : Math.floor(x * 1e6));

/** `cfg()` identik di A, B, C (brief §2.2). */
export const CFG: PoolCfg = { feeBps: 300, maxUtilBps: 8000, vegaCapBps: 500, minPremiumBps: 5, heartbeat: 3600, staleMult: 3, sequencerGrace: 3600, maxOpenSeries: 32, tenorMax: 2_592_000, minSize: 10n ** 16n, settleBounty: 2_000_000n };
/** params() + observasi engine terakhir (Appendix C: σ_base 0.5483, σ_mark(0) 0.6306, lastTs 1789900003). */
export const VOL: VolState = {
  sigmaBase: toWad(0.548348), sigmaMark0: toWad(0.548348 * 1.15), varWad: toWad(0.300645),
  lambdaPerDay: toWad(0.94), vrp: toWad(1.15), alpha: toWad(0.30), spread: toWad(0.05), sigmaMin: toWad(0.20), sigmaMax: toWad(3),
  lastRoundId: 18_446_744_073_710_941_823n, lastTs: 1_789_900_003,
};
/** σ_buy efektif per pool (Appendix C baris 1: 0.6613 | 0.6614 | 0.8566 — C di clamp inventori karena pool kecil). */
const SIGMA_BUY: Record<PoolKey, number> = { A: 0.6613, B: 0.6614, C: 0.8566 };
const SIGMA_CLOSE = 0.548348 * 1.15 * 0.95;

// --- Black-Scholes kecil untuk premi fixture yang masuk akal (tidak pernah dipakai UI) ---
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}
function bs(S: number, K: number, t: number, sigma: number, isCall: boolean): { price: number; delta: number; vega: number } {
  if (t <= 0) return { price: Math.max(isCall ? S - K : K - S, 0), delta: isCall ? (S > K ? 1 : 0) : S < K ? -1 : 0, vega: 0 };
  const v = sigma * Math.sqrt(t);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * t) / v, d2 = d1 - v;
  const vega = S * (Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI)) * Math.sqrt(t);
  return isCall ? { price: S * normCdf(d1) - K * normCdf(d2), delta: normCdf(d1), vega } : { price: K * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1, vega };
}
/** Harga satu unit (USD): call = C(K) − C(2K) (capped), put = BS biasa; r = 0 (brief §4.4). */
export function unitPrice(ref: SeriesRef, sigma: number, blockTime = BLOCK_TIME, spot = SPOT): { price: number; delta: number; vega: number } {
  const t = (ref.expiry - blockTime) / 31_536_000;
  if (!ref.isCall) return bs(spot, ref.strike, t, sigma, false);
  const a = bs(spot, ref.strike, t, sigma, true), b = bs(spot, 2 * ref.strike, t, sigma, true);
  return { price: a.price - b.price, delta: a.delta - b.delta, vega: a.vega - b.vega };
}
export function quoteFor(k: PoolKey, ref: SeriesRef, blockTime = BLOCK_TIME): Quote {
  const q = unitPrice(ref, SIGMA_BUY[k], blockTime);
  const premium = to6(Math.max(q.price, ref.strike * CFG.minPremiumBps / 10_000), true);
  return { premium, fee: (premium * BigInt(CFG.feeBps) + 9_999n) / 10_000n, sigma: toWad(SIGMA_BUY[k]), delta: toWad(q.delta), vega: toWad(Math.max(q.vega, 0)), spot: FEED_ANSWER * 10n ** 10n };
}
export function closeFor(ref: SeriesRef, blockTime = BLOCK_TIME): bigint { return to6(Math.max(unitPrice(ref, SIGMA_CLOSE, blockTime).price, 0), false); }

// --- posisi demo Appendix C: 5 × C 2800 #0 dan 1 × P 2400 #0 di A dan B (C: tidak ada) ---
export interface PositionSpec { k: PoolKey; i: number; units: bigint }
export function demoPositions(): PositionSpec[] {
  const c2800 = ALL_SERIES.findIndex((s) => s.boardId === 0 && s.strike === 2800 && s.isCall);
  const p2400 = ALL_SERIES.findIndex((s) => s.boardId === 0 && s.strike === 2400 && !s.isCall);
  return POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint').flatMap((k) => [{ k, i: c2800, units: 5n * WAD }, { k, i: p2400, units: WAD }]);
}
const oiOf = (k: PoolKey, i: number) => demoPositions().filter((p) => p.k === k && p.i === i).reduce((a, p) => a + p.units, 0n);

// --- pool per Appendix C (NAV A/B 1,000,102.51 / 1,000,103.16; C 90.264867) ---
function poolFor(k: PoolKey): PoolState {
  const reserved = ALL_SERIES.reduce((a, s, i) => a + (oiOf(k, i) * BigInt(s.strike)), 0n);   // Σ OI × K (WAD karena OI WAD)
  const base = k === 'A'
    ? { totalAssets: 1_000_102_510_411n, totalSupply: 1_000_000_000_000n, cash: 1_000_122_000_000n * ASSET_SCALE, netVega: 2_100n * WAD, capitalRefPrev: 1_000_000n * WAD }
    : k === 'B'
      ? { totalAssets: 1_000_103_157_194n, totalSupply: 1_000_000_000_000n, cash: 1_000_123_000_000n * ASSET_SCALE, netVega: 2_110n * WAD, capitalRefPrev: 1_000_000n * WAD }
      : { totalAssets: 90_264_867n, totalSupply: 90_000_000n, cash: 90_264_867n * ASSET_SCALE, netVega: 0n, capitalRefPrev: 100n * WAD };
  const escrow = 0n;
  const cap = base.cash - escrow < base.capitalRefPrev ? base.cash - escrow : base.capitalRefPrev;
  const vegaCap = (cap * BigInt(CFG.vegaCapBps)) / 10_000n;
  const util = vegaCap === 0n ? 1 : Math.min(Number(base.netVega) / Number(vegaCap), 1);
  return {
    ...base, reserved, escrow, freeLiquidity: (base.cash - escrow - reserved) / ASSET_SCALE,
    sigmaMarkNow: toWad(0.548348 * 1.15 * (1 + 0.3 * util)), tradingPaused: false, owner: OWNER, cfg: { ...CFG },
    boards: BOARDS.map(() => ({ settled: false, settlementPrice: 0n })),
  };
}
function seriesFor(blockTime: number): SeriesRow[] {
  const last = ALL_SERIES.length - 1;
  return ALL_SERIES.map((ref, i) => {
    const st = (k: PoolKey): SeriesState => ({
      oi: oiOf(k, i), settled: false, payoutPerUnit: 0n,
      // Satu seri (yang terakhir) tanpa kuotasi + nama revert: jalur "kenapa kuotasi kosong" (brief §5).
      buy: i === last ? null : quoteFor(k, ref, blockTime), buyError: i === last ? 'SeriesExpired' : null, close: i === last ? null : closeFor(ref, blockTime),
    });
    return { ref, ...Object.fromEntries(POOL_KEYS.map((k) => [k, st(k)])) } as SeriesRow;
  });
}

/** Snapshot "live": semua board terbuka, kuotasi per pool di setiap seri kecuali yang terakhir (`SeriesExpired`), tanpa akun. */
export function liveSnapshot(): Snapshot {
  return {
    fetchedAtMs: Date.now(), blockNumber: BLOCK, blockTime: BLOCK_TIME,
    feed: { answer: FEED_ANSWER, updatedAt: FEED_UPDATED_AT, spotWad: FEED_ANSWER * 10n ** 10n },
    vol: { ...VOL },
    pools: Object.fromEntries(POOL_KEYS.map((k) => [k, poolFor(k)])) as Record<PoolKey, PoolState>,
    series: seriesFor(BLOCK_TIME),
    user: null,
  };
}

// --- mutator (murni) ---
const clone = (s: Snapshot): Snapshot => ({
  ...s, feed: { ...s.feed }, vol: { ...s.vol },
  pools: Object.fromEntries(POOL_KEYS.map((k) => [k, { ...s.pools[k], cfg: { ...s.pools[k].cfg }, boards: s.pools[k].boards.map((b) => ({ ...b })) }])) as Record<PoolKey, PoolState>,
  series: s.series.map((r) => ({ ref: r.ref, ...Object.fromEntries(POOL_KEYS.map((k) => [k, { ...r[k], buy: r[k].buy ? { ...r[k].buy } : null }])) } as SeriesRow)),
  user: s.user ? { ...s.user, asset: { ...s.user.asset }, allowance: { ...s.user.allowance }, shares: { ...s.user.shares }, positions: Object.fromEntries(POOL_KEYS.map((k) => [k, [...s.user!.positions[k]]])) as Record<PoolKey, bigint[]> } : null,
});
/** Geser waktu blok; seri dengan `expiry ≤ blockTime + 60` kehilangan kuotasi (`SeriesExpired`) seperti `_openSeries` on-chain. */
function atBlockTime(s: Snapshot, blockTime: number): Snapshot {
  const n = clone(s);
  n.blockTime = blockTime; n.feed.updatedAt = blockTime - 38;
  for (const r of n.series) for (const k of POOL_KEYS) {
    if (r[k].settled) continue;
    if (r.ref.expiry <= blockTime + 60) { r[k].buy = null; r[k].buyError = 'SeriesExpired'; r[k].close = null; }
    else if (r[k].buyError === 'SeriesExpired') { r[k].buy = quoteFor(k, r.ref, blockTime); r[k].buyError = null; r[k].close = closeFor(r.ref, blockTime); }
  }
  return n;
}
/** Snapshot tua (> 60 s): `chainState()` menurunkannya menjadi meta.stale = true + error RPC dengan data tetap ada. */
export function withStale(s: Snapshot): Snapshot { return { ...clone(s), fetchedAtMs: Date.now() - STALE_MS - 30_000 }; }
/** Board `boardId` settle di harga `price` (USD) di semua pool: payout per unit (brief §4.8), escrow += Σ OI × payout, reserved −= Σ OI × K, blockTime ≥ expiry. */
export function withSettled(s: Snapshot, boardId: number, price: number): Snapshot {
  const board = BOARDS.find((b) => b.id === boardId)!;
  const n = atBlockTime(s, Math.max(s.blockTime, board.expiry + 300));
  const sT = toWad(price);
  for (const k of POOL_KEYS) {
    const p = n.pools[k];
    p.boards[boardId] = { settled: true, settlementPrice: sT };
    let added = 0n, released = 0n;
    for (const r of n.series) {
      if (r.ref.boardId !== boardId) continue;
      const K = BigInt(r.ref.strike) * WAD;
      const payout = r.ref.isCall ? (sT > K ? (sT - K < K ? sT - K : K) : 0n) : K > sT ? K - sT : 0n;
      const st = r[k];
      added += (st.oi * payout) / WAD; released += (st.oi * K) / WAD;
      st.settled = true; st.payoutPerUnit = payout; st.buy = null; st.buyError = 'SeriesSettled'; st.close = null;
    }
    p.escrow += added; p.reserved = p.reserved > released ? p.reserved - released : 0n;
    const free = p.cash - p.escrow - p.reserved; p.freeLiquidity = free > 0n ? free / ASSET_SCALE : 0n;
  }
  return n;
}
/** Board seri ke-`seriesIdx` 30 s sebelum expiry: semua seri board itu (dan board yang sudah lewat) tanpa kuotasi (`SeriesExpired`). */
export function withBlackout(s: Snapshot, seriesIdx: number): Snapshot { return atBlockTime(s, ALL_SERIES[seriesIdx]!.expiry - 30); }
/** Board `boardId` sudah expiry tetapi belum settle ("expired — awaiting settle"). */
export function withExpired(s: Snapshot, boardId: number): Snapshot { return atBlockTime(s, BOARDS.find((b) => b.id === boardId)!.expiry + 300); }
/** `tradingPaused` di pool k (kuotasi view tetap ada — `quoteBuy` tidak memeriksa pause; `buy` yang revert). */
export function withPaused(s: Snapshot, k: PoolKey): Snapshot { const n = clone(s); n.pools[k].tradingPaused = true; return n; }
/** Round Chainlink lebih tua dari heartbeat × staleMult (3 h): semua kuotasi revert `OracleStale` (`_requireFresh`). */
export function withOracleStale(s: Snapshot): Snapshot {
  const n = clone(s);
  n.feed.updatedAt = s.blockTime - (CFG.heartbeat * CFG.staleMult + 600);
  for (const r of n.series) for (const k of POOL_KEYS) if (!r[k].settled) { r[k].buy = null; r[k].buyError = 'OracleStale'; r[k].close = null; }
  return n;
}
export interface UserSpec { address?: Address; positions?: PositionSpec[]; asset?: Partial<Record<PoolKey, bigint>>; shares?: Partial<Record<PoolKey, bigint>>; allowance?: Partial<Record<PoolKey, bigint>> }
/** Akun terhubung dengan default Appendix C (aset A/B 1,999,742.195639 mock, C 9.735133 Paxos; share 1e12 / 1e12 / 90e6; allowance MAX, C = MAX − 1296150; posisi demo). */
export function withUser(s: Snapshot, u: UserSpec = {}): Snapshot {
  const n = clone(s);
  const pick = <T,>(o: Partial<Record<PoolKey, T>> | undefined, k: PoolKey, d: T): T => (o && o[k] !== undefined ? o[k]! : d);
  const dAsset = (k: PoolKey) => (POOLS[k].faucet === 'mint' ? 1_999_742_195_639n : 9_735_133n);
  const dShares = (k: PoolKey) => (POOLS[k].faucet === 'mint' ? 1_000_000_000_000n : 90_000_000n);
  const dAllow = (k: PoolKey) => (POOLS[k].faucet === 'mint' ? MAX_UINT : MAX_UINT - 1_296_150n);
  const positions = u.positions ?? demoPositions();
  const user: UserState = {
    address: u.address ?? USER,
    asset: Object.fromEntries(POOL_KEYS.map((k) => [k, pick(u.asset, k, dAsset(k))])) as Record<PoolKey, bigint>,
    allowance: Object.fromEntries(POOL_KEYS.map((k) => [k, pick(u.allowance, k, dAllow(k))])) as Record<PoolKey, bigint>,
    shares: Object.fromEntries(POOL_KEYS.map((k) => [k, pick(u.shares, k, dShares(k))])) as Record<PoolKey, bigint>,
    positions: Object.fromEntries(POOL_KEYS.map((k) => [k, ALL_SERIES.map((_, i) => positions.filter((p) => p.k === k && p.i === i).reduce((a, p) => a + p.units, 0n))])) as Record<PoolKey, bigint[]>,
  };
  n.user = user;
  return n;
}

// --- paritas, gas, dan ChainState lengkap untuk test halaman ---
/** Paritas K5 ✓ pada setiap seri hidup (priceSol = priceStylus = harga σ_mark(0), WAD); seri blackout/expired/settled → null (seperti readParity). */
export function liveParity(s: Snapshot): ParityRow[] {
  return s.series.map(({ ref }) => {
    if (ref.expiry <= s.blockTime + 60) return { ref, ok: null, priceSol: null, priceStylus: null };
    const p0 = toWad(Math.max(unitPrice(ref, Number(s.vol.sigmaMark0) / 1e18, s.blockTime).price, 0));
    return { ref, ok: true, priceSol: p0, priceStylus: p0 };
  });
}
/** Estimasi gas buy(1 unit) seri ATM, A vs B (angka dari `test:network` 21 Sep 2026: 369 316 / 327 312); null tanpa board terbuka. */
export function liveGas(s: Snapshot): GasEstimate | null {
  const row = atmSeries(s); if (!row) return null;
  const gas = Object.fromEntries(GAS_KEYS.map((k) => [k, k === 'A' ? 369_316n : 327_312n])) as GasEstimate['gas'];
  return { strike: row.ref.strike, expiry: row.ref.expiry, gas };
}
export type StateOverrides = Partial<Omit<ChainState, 'meta'>> & { meta?: Partial<Meta>; nowMs?: number };
/** ChainState lengkap untuk merender halaman tanpa provider: `<ChainContext.Provider value={chainState({...})}>`.
 *  meta diturunkan dari `snapshot.fetchedAtMs` (withStale → stale + error, data tetap); fungsi aksi = no-op kecuali di-override. */
export function chainState(over: StateOverrides = {}): ChainState {
  const snapshot = over.snapshot === undefined ? liveSnapshot() : over.snapshot;
  const nowMs = over.nowMs ?? Date.now();
  const lastOkMs = snapshot ? snapshot.fetchedAtMs : null;
  const stale = lastOkMs !== null && isStale(lastOkMs, nowMs);
  const meta: Meta = { nowMs, lastOkMs, error: stale ? 'HTTP request failed.' : null, stale, refreshes: snapshot ? 1 : 0, ...over.meta };
  const { meta: _m, nowMs: _n, ...rest } = over;
  return {
    client: {} as Client, snapshot, parity: snapshot ? liveParity(snapshot) : [], gas: snapshot ? liveGas(snapshot) : null,
    events: { trades: [], observed: [] }, eventsState: 'seed', account: snapshot?.user?.address ?? null, wrongChain: false, hasWallet: false, busy: false, txLog: [],
    refreshNow: () => {}, connect: async () => {}, run: async () => {},
    ...rest, meta,
  };
}
