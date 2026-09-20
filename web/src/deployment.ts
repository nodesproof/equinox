import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters } from 'viem';
import manifest from '@deployment';

export type PoolKey = 'A' | 'B';
export const CHAIN_ID = manifest.chainId;                 // 421614
export const RPC_URL = manifest.rpc;
export const EXPLORER = 'https://sepolia.arbiscan.io';
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const P = manifest.pools;
export const POOLS = {
  A: { pool: getAddress(P.A.pool), token: getAddress(P.A.token), math: getAddress(P.A.math), label: 'Pool A — control (BlackScholesSol)' },
  B: { pool: getAddress(P.B.pool), token: getAddress(P.B.token), math: getAddress(P.B.math), label: 'Pool B — Equinox (Stylus, cached)' },
} as const;
export const POOL_KEYS: PoolKey[] = ['A', 'B'];
export const VOL = getAddress(P.vol);
export const USDG = getAddress(P.usdg);
export const SEQ = getAddress(P.sequencerFeed);
export const FEED = getAddress(P.feed);
export const DEPLOYER = getAddress(P.deployer);
export const DEPLOYED_AT_BLOCK = BigInt(P.deployedAtBlock);
export const MATH_SOL = getAddress(manifest.blackScholesSol);
export const MATH_STYLUS = getAddress(manifest.blackScholesStylus);

export interface Board { id: number; expiry: number; strikes: number[]; seriesIds: { A: bigint[]; B: bigint[] } }
export const BOARDS: Board[] = P.boards.map((b) => ({
  id: b.id, expiry: b.expiry, strikes: b.strikes.map(Number),
  seriesIds: { A: b.seriesIds.A.map(BigInt), B: b.seriesIds.B.map(BigInt) },
}));

export interface SeriesRef { boardId: number; expiry: number; strike: number; isCall: boolean; idx: number; id: { A: bigint; B: bigint } }
/** Urutan seri per board: [C K0, P K0, C K1, P K1, C K2, P K2] (EquinoxPool.createBoard). */
export const ALL_SERIES: SeriesRef[] = BOARDS.flatMap((b) =>
  b.strikes.flatMap((strike, i) => [true, false].map((isCall, c) => {
    const idx = 2 * i + c;
    return { boardId: b.id, expiry: b.expiry, strike, isCall, idx, id: { A: b.seriesIds.A[idx]!, B: b.seriesIds.B[idx]! } };
  })),
);

/** keccak256(abi.encode(pool, expiry, strike, isCall)) — sama dengan EquinoxOptionToken.seriesId. */
export function seriesId(pool: `0x${string}`, expiry: number, strikeWad: bigint, isCall: boolean): bigint {
  return BigInt(keccak256(encodeAbiParameters(parseAbiParameters('address, uint64, uint128, bool'), [pool, BigInt(expiry), strikeWad, isCall])));
}
export const WAD = 10n ** 18n;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const COMMIT = __COMMIT__;
export const BUILD_TIME = __BUILD_TIME__;
