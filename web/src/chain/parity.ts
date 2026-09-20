// parity.ts — K5: kedua kontrak math dengan input identik harus byte-identik.
import type { Client } from './client';
import { ALL_SERIES, MATH_SOL, MATH_STYLUS, WAD, type SeriesRef } from '../deployment';
import { blackScholesAbi } from '../abi/blackScholes';
import type { Snapshot } from './snapshot';

export interface ParityRow { ref: SeriesRef; ok: boolean | null; priceSol: bigint | null; priceStylus: bigint | null }
/** t (tahun, WAD) persis seperti `EquinoxPool._years`: (expiry − now) × 1e18 / 31 536 000. */
export const yearsWad = (expiry: number, blockTime: number) => (BigInt(expiry - blockTime) * WAD) / 31_536_000n;

export async function readParity(client: Client, s: Snapshot): Promise<ParityRow[]> {
  const live = ALL_SERIES.filter((r) => r.expiry > s.blockTime + 60);
  const S = s.feed.spotWad, sigma0 = s.vol.sigmaMark0;
  // Input sama dengan `EquinoxPool._price` pada σ_mark(0): call → cappedCall(S, K, 2K, t, σ₀, r=0); put → quote(S, K, t, σ₀, r=0, false).
  const call = (math: `0x${string}`, r: SeriesRef) => {
    const K = BigInt(r.strike) * WAD, t = yearsWad(r.expiry, s.blockTime);
    return r.isCall
      ? { address: math, abi: blackScholesAbi, functionName: 'cappedCall', args: [S, K, 2n * K, t, sigma0, 0n] } as const
      : { address: math, abi: blackScholesAbi, functionName: 'quote', args: [S, K, t, sigma0, 0n, false] } as const;
  };
  const res = await client.multicall({ blockNumber: s.blockNumber, allowFailure: true, contracts: live.flatMap((r) => [call(MATH_SOL, r), call(MATH_STYLUS, r)]) });
  const priceOf = (x: (typeof res)[number]) => (x.status === 'success' ? (x.result as readonly bigint[])[0]! : null);
  // Tuple penuh (harga + Greeks) dibandingkan tanpa toleransi — bigint → string agar JSON.stringify bisa.
  const rows = new Map(live.map((r, i) => {
    const a = res[2 * i]!, b = res[2 * i + 1]!;
    const same = a.status === 'success' && b.status === 'success' && JSON.stringify(a.result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b.result, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return [r.id.A, { ref: r, ok: a.status === 'success' && b.status === 'success' ? same : null, priceSol: priceOf(a), priceStylus: priceOf(b) }];
  }));
  return ALL_SERIES.map((r) => rows.get(r.id.A) ?? { ref: r, ok: null, priceSol: null, priceStylus: null });
}
