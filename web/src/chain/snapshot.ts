import type { Address, ContractFunctionParameters } from 'viem';
import type { Client } from './client';
import { ALL_SERIES, BOARDS, FEED, POOLS, POOL_KEYS, VOL, WAD, type PoolKey, type SeriesRef } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { equinoxVolEngineAbi } from '../abi/equinoxVolEngine';
import { equinoxOptionTokenAbi } from '../abi/equinoxOptionToken';
import { mockUsdgAbi } from '../abi/mockUsdg';
import { aggregatorV3Abi } from '../abi/aggregatorV3';

// Satu `Snapshot` per refresh: tiga multicall (inti, seri, pengguna) yang semuanya dipaku ke blok yang sama; setiap bagian per pool diiterasi dari `POOL_KEYS`.
export interface Quote { premium: bigint; fee: bigint; sigma: bigint; delta: bigint; vega: bigint; spot: bigint }
export interface PoolState {
  totalAssets: bigint; totalSupply: bigint; reserved: bigint; escrow: bigint; netVega: bigint; freeLiquidity: bigint;
  sigmaMarkNow: bigint; capitalRefPrev: bigint; tradingPaused: boolean; cash: bigint; owner: Address;
  boards: { settled: boolean; settlementPrice: bigint }[];
}
export interface SeriesState { oi: bigint; settled: boolean; payoutPerUnit: bigint; buy: Quote | null; buyError: string | null; close: bigint | null }
export type SeriesRow = { ref: SeriesRef } & Record<PoolKey, SeriesState>;
/** `asset[k]` = saldo aset pool k di wallet (A/B: MockUSDG yang sama, C: USDG Paxos) — satu entri per pool karena asetnya bisa berbeda. */
export interface UserState { address: Address; asset: Record<PoolKey, bigint>; allowance: Record<PoolKey, bigint>; shares: Record<PoolKey, bigint>; positions: Record<PoolKey, bigint[]> }
export interface Snapshot {
  fetchedAtMs: number; blockNumber: bigint; blockTime: number;
  feed: { answer: bigint; updatedAt: number; spotWad: bigint };
  vol: { sigmaBase: bigint; sigmaMark0: bigint; varWad: bigint; vrp: bigint; alpha: bigint; spread: bigint };
  pools: Record<PoolKey, PoolState>;
  series: SeriesRow[];
  user: UserState | null;
}

const ONE = WAD;
/** Aset 6 dp (MockUSDG maupun USDG Paxos) → WAD (EquinoxPool.assetScale = 10^(18−6)); `cash` disimpan dalam WAD agar satu satuan dengan escrow/reserved/capitalRefPrev. */
const ASSET_SCALE = 10n ** 12n;
/** Pelebaran tipe: viem tidak bisa menginfer multicall heterogen yang dibangun lewat flatMap (TS2589); hasil dibaca lewat `MC`. */
type Call = ContractFunctionParameters;
type MC = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };
const ok = <T,>(r: MC | undefined): T | null => (r && r.status === 'success' ? (r.result as T) : null);
const must = <T,>(r: MC | undefined, what: string): T => { const v = ok<T>(r); if (v === null) throw new Error(`multicall: ${what} failed`); return v; };
const errName = (r: MC | undefined): string | null => {
  if (!r || r.status !== 'failure') return null;
  // Nama custom error hasil decode (mis. SeriesExpired, OracleStale) lebih informatif daripada shortMessage viem yang generik.
  for (let e: unknown = r.error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const n = (e as { data?: { errorName?: string } }).data?.errorName;
    if (n) return n;
  }
  return (r.error as { shortMessage?: string }).shortMessage ?? r.error.message;
};

export async function readSnapshot(client: Client, account?: Address): Promise<Snapshot> {
  const block = await client.getBlock();
  const bn = block.number;
  const pool = (k: PoolKey) => ({ address: POOLS[k].pool, abi: equinoxPoolAbi } as const);
  const vol = { address: VOL, abi: equinoxVolEngineAbi } as const;
  // --- inti: feed, engine, setiap pool (POOL_KEYS), board ---
  const coreCalls: Call[] = [
    { address: FEED, abi: aggregatorV3Abi, functionName: 'latestRoundData' },
    { ...vol, functionName: 'sigmaBase' }, { ...vol, functionName: 'sigmaMark', args: [0n] }, { ...vol, functionName: 'varWad' }, { ...vol, functionName: 'params' },
    ...POOL_KEYS.flatMap((k) => [
      { ...pool(k), functionName: 'totalAssets' }, { ...pool(k), functionName: 'totalSupply' }, { ...pool(k), functionName: 'reserved' },
      { ...pool(k), functionName: 'escrowedPayouts' }, { ...pool(k), functionName: 'netVega' }, { ...pool(k), functionName: 'freeLiquidity' },
      { ...pool(k), functionName: 'sigmaMarkNow' }, { ...pool(k), functionName: 'capitalRefPrev' }, { ...pool(k), functionName: 'tradingPaused' },
      { address: POOLS[k].asset, abi: mockUsdgAbi, functionName: 'balanceOf', args: [POOLS[k].pool] }, { ...pool(k), functionName: 'owner' },
      ...BOARDS.map((b) => ({ ...pool(k), functionName: 'board', args: [BigInt(b.id)] })),
    ]),
  ];
  const core = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: coreCalls }) as MC[];
  const per = 11 + BOARDS.length;
  const rd = must<readonly [bigint, bigint, bigint, bigint, bigint]>(core[0], 'latestRoundData');
  const params = must<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(core[4], 'params');
  const pools = {} as Record<PoolKey, PoolState>;
  POOL_KEYS.forEach((k, i) => {
    const o = 5 + i * per;
    pools[k] = {
      totalAssets: must(core[o], 'totalAssets'), totalSupply: must(core[o + 1], 'totalSupply'), reserved: must(core[o + 2], 'reserved'),
      escrow: must(core[o + 3], 'escrowedPayouts'), netVega: must(core[o + 4], 'netVega'), freeLiquidity: must(core[o + 5], 'freeLiquidity'),
      sigmaMarkNow: ok<bigint>(core[o + 6]) ?? 0n, capitalRefPrev: must(core[o + 7], 'capitalRefPrev'), tradingPaused: must(core[o + 8], 'tradingPaused'),
      cash: must<bigint>(core[o + 9], 'cash') * ASSET_SCALE, owner: must(core[o + 10], 'owner'),
      boards: BOARDS.map((_, j) => { const b = must<readonly [bigint, boolean, bigint, readonly bigint[]]>(core[o + 11 + j], 'board'); return { settled: b[1], settlementPrice: b[2] }; }),
    };
  });
  // --- seri: series(id), quoteBuy(id, 1), quoteClose(id, 1) per pool ---
  const seriesCalls: Call[] = ALL_SERIES.flatMap((s) => POOL_KEYS.flatMap((k) => [
    { ...pool(k), functionName: 'series', args: [s.id[k]] },
    { ...pool(k), functionName: 'quoteBuy', args: [s.id[k], ONE] },
    { ...pool(k), functionName: 'quoteClose', args: [s.id[k], ONE] },
  ]));
  const sc = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: seriesCalls }) as MC[];
  const series: SeriesRow[] = ALL_SERIES.map((ref, i) => {
    const st = (k: PoolKey, j: number): SeriesState => {
      const o = (i * POOL_KEYS.length + j) * 3;
      const sr = must<readonly [number, bigint, bigint, boolean, boolean, bigint, bigint, bigint]>(sc[o], 'series');
      const q = ok<{ premiumAssets: bigint; feeAssets: bigint; sigma: bigint; delta: bigint; vegaTotal: bigint; spotWad: bigint }>(sc[o + 1]);
      const c = ok<readonly [bigint, bigint, bigint]>(sc[o + 2]);
      return { oi: sr[5], settled: sr[4], payoutPerUnit: sr[7],
        buy: q ? { premium: q.premiumAssets, fee: q.feeAssets, sigma: q.sigma, delta: q.delta, vega: q.vegaTotal, spot: q.spotWad } : null,
        buyError: q ? null : errName(sc[o + 1]), close: c ? c[0] : null };
    };
    return { ref, ...Object.fromEntries(POOL_KEYS.map((k, j) => [k, st(k, j)])) } as SeriesRow;
  });
  // --- pengguna (opsional) ---
  let user: UserState | null = null;
  if (account) {
    // Per pool: saldo aset pool itu di wallet, allowance aset → pool, share LP, lalu posisi tiap seri (aset dibaca per pool karena C memakai token lain).
    const userCalls: Call[] = POOL_KEYS.flatMap((k) => [
      { address: POOLS[k].asset, abi: mockUsdgAbi, functionName: 'balanceOf', args: [account] },
      { address: POOLS[k].asset, abi: mockUsdgAbi, functionName: 'allowance', args: [account, POOLS[k].pool] },
      { ...pool(k), functionName: 'balanceOf', args: [account] },
      ...ALL_SERIES.map((s) => ({ address: POOLS[k].token, abi: equinoxOptionTokenAbi, functionName: 'balanceOf', args: [account, s.id[k]] })),
    ]);
    const uc = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: userCalls }) as MC[];
    const n = 3 + ALL_SERIES.length;
    const u = { address: account, asset: {}, allowance: {}, shares: {}, positions: {} } as UserState;
    POOL_KEYS.forEach((k, i) => {
      const o = i * n;
      u.asset[k] = ok<bigint>(uc[o]) ?? 0n; u.allowance[k] = ok<bigint>(uc[o + 1]) ?? 0n; u.shares[k] = ok<bigint>(uc[o + 2]) ?? 0n;
      u.positions[k] = ALL_SERIES.map((_, j) => ok<bigint>(uc[o + 3 + j]) ?? 0n);
    });
    user = u;
  }
  return {
    fetchedAtMs: Date.now(), blockNumber: bn, blockTime: Number(block.timestamp),
    feed: { answer: rd[1], updatedAt: Number(rd[3]), spotWad: rd[1] * 10n ** 10n },
    vol: { sigmaBase: must(core[1], 'sigmaBase'), sigmaMark0: must(core[2], 'sigmaMark0'), varWad: must(core[3], 'varWad'), vrp: params[1], alpha: params[2], spread: params[3] },
    pools, series, user,
  };
}

/** Seri ATM terdekat pada board terbuka terdekat — untuk counter gas dan sorotan baris. */
export function atmSeries(s: Snapshot): SeriesRow | null {
  // Status settled dibaca dari pool pertama (semua pool mendaftar board yang sama; settle per pool bisa berbeda beberapa blok).
  const k0 = POOL_KEYS[0]!;
  const open = s.series.filter((r) => !r[k0].settled && r.ref.expiry > s.blockTime + 60 && r.ref.isCall);
  if (open.length === 0) return null;
  const spot = Number(s.feed.spotWad) / 1e18;
  const nearestExpiry = Math.min(...open.map((r) => r.ref.expiry));
  return open.filter((r) => r.ref.expiry === nearestExpiry).sort((a, b) => Math.abs(a.ref.strike - spot) - Math.abs(b.ref.strike - spot))[0] ?? null;
}
