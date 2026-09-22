import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Address } from 'viem';
import manifest from '@deployment';

export const CHAIN_ID = manifest.chainId;                 // 421614
export const RPC_URL = manifest.rpc;
export const EXPLORER = 'https://sepolia.arbiscan.io';
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export type PoolKey = 'A' | 'B' | 'C';
export type FaucetKind = 'mint' | 'paxos';
export interface PoolInfo { pool: Address; token: Address; math: Address; label: string; asset: Address; assetSymbol: string; faucet: FaucetKind }
type RawPool = { pool: string; token: string; math: string; asset?: string; assetSymbol?: string; assetKind?: string };
const P = manifest.pools;
// Pool C opsional di manifest (ada setelah tools/sepolia/pool-c.sh deploy); A/B ber-aset mock (`pools.usdg`, faucet = mint terbuka).
const RAW: Partial<Record<PoolKey, RawPool>> = { A: P.A, B: P.B, C: (P as { C?: RawPool }).C };
const LABEL: Record<PoolKey, string> = { A: 'Pool A — control (BlackScholesSol)', B: 'Pool B — Equinox (Stylus, cached)', C: 'Pool C — Equinox on real USDG (Stylus, cached)' };
/** Kunci pool yang ada di manifest, urut A, B, C — satu-satunya daftar pool; jangan mengindeks `POOLS` dengan kunci di luar ini. */
export const POOL_KEYS: PoolKey[] = (['A', 'B', 'C'] as PoolKey[]).filter((k) => RAW[k] !== undefined);
export const POOLS = Object.fromEntries(POOL_KEYS.map((k) => {
  const r = RAW[k]!;
  return [k, { pool: getAddress(r.pool), token: getAddress(r.token), math: getAddress(r.math), label: LABEL[k],
    asset: getAddress(r.asset ?? P.usdg), assetSymbol: r.assetSymbol ?? 'USDG', faucet: r.assetKind === 'paxos' ? 'paxos' : 'mint' } satisfies PoolInfo];
})) as Record<PoolKey, PoolInfo>;
/** Counter gas & paritas K5 selalu A (Solidity) vs B (Stylus); C memakai math yang sama dengan B. */
export const GAS_KEYS = ['A', 'B'] as const;
export const PAXOS_FAUCET = 'https://faucet.paxos.com/';
export const WAD = 10n ** 18n;
export const VOL = getAddress(P.vol);
/** MockUSDG — aset Pool A/B (mint terbuka = faucet). Aset per pool ada di `POOLS[k].asset`; Pool C memakai USDG Paxos asli. */
export const USDG = getAddress(P.usdg);
export const SEQ = getAddress(P.sequencerFeed);
export const FEED = getAddress(P.feed);
export const DEPLOYER = getAddress(P.deployer);
export const DEPLOYED_AT_BLOCK = BigInt(P.deployedAtBlock);
/** Waktu blok deploy (unix s) dari `pools.deployedAt` manifest — anchor kedua interpolasi "≈ waktu blok" di dashboard (bersama blok/waktu snapshot). */
export const DEPLOYED_AT = Math.floor(Date.parse(P.deployedAt) / 1000);
export const MATH_SOL = getAddress(manifest.blackScholesSol);
export const MATH_STYLUS = getAddress(manifest.blackScholesStylus);

export interface Board { id: number; expiry: number; strikes: number[]; seriesIds: Record<PoolKey, bigint[]> }
export interface SeriesRef { boardId: number; expiry: number; strike: number; isCall: boolean; idx: number; id: Record<PoolKey, bigint> }
/** keccak256(abi.encode(pool, expiry, strike, isCall)) — sama dengan EquinoxOptionToken.seriesId. */
export function seriesId(pool: `0x${string}`, expiry: number, strikeWad: bigint, isCall: boolean): bigint {
  return BigInt(keccak256(encodeAbiParameters(parseAbiParameters('address, uint64, uint128, bool'), [pool, BigInt(expiry), strikeWad, isCall])));
}
type RawBoard = { id: number; expiry: number; strikes: string[]; seriesIds: Partial<Record<PoolKey, string[]>> };
/** Id seri per pool: dari manifest bila ada, selain itu diturunkan (deterministik, sama dengan EquinoxOptionToken.seriesId). */
export const BOARDS: Board[] = (P.boards as RawBoard[]).map((b) => ({
  id: b.id, expiry: b.expiry, strikes: b.strikes.map(Number),
  seriesIds: Object.fromEntries(POOL_KEYS.map((k) => [k, b.seriesIds[k]?.map(BigInt)
    ?? b.strikes.flatMap((s) => [true, false].map((c) => seriesId(POOLS[k].pool, b.expiry, BigInt(s) * WAD, c)))])) as Record<PoolKey, bigint[]>,
}));
/** Urutan seri per board: [C K0, P K0, C K1, P K1, C K2, P K2] (EquinoxPool.createBoard). */
export const ALL_SERIES: SeriesRef[] = BOARDS.flatMap((b) => b.strikes.flatMap((strike, i) => [true, false].map((isCall, c) => {
  const idx = 2 * i + c;
  return { boardId: b.id, expiry: b.expiry, strike, isCall, idx, id: Object.fromEntries(POOL_KEYS.map((k) => [k, b.seriesIds[k][idx]!])) as Record<PoolKey, bigint> };
})));

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const COMMIT = __COMMIT__;
export const BUILD_TIME = __BUILD_TIME__;
