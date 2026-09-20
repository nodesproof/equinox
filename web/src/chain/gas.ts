// gas.ts — estimasi gas `buy(id, 1, max)` dari wallet owner (punya USDG + allowance) untuk seri ATM, A vs B (GAS_KEYS; C memakai math yang sama dengan B).
import type { Client } from './client';
import { GAS_KEYS, POOLS } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { atmSeries, type Snapshot } from './snapshot';
const MAX = 2n ** 256n - 1n;
export type GasKey = (typeof GAS_KEYS)[number];
export interface GasEstimate { strike: number; expiry: number; gas: Record<GasKey, bigint | null> }
export async function readGas(client: Client, s: Snapshot): Promise<GasEstimate | null> {
  const row = atmSeries(s); if (!row) return null;
  const gas = Object.fromEntries(GAS_KEYS.map((k) => [k, null])) as Record<GasKey, bigint | null>;
  await Promise.all(GAS_KEYS.map(async (k) => {
    try { gas[k] = await client.estimateContractGas({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'buy', args: [row.ref.id[k], 10n ** 18n, MAX], account: s.pools[k].owner }); }
    catch { gas[k] = null; }
  }));
  return { strike: row.ref.strike, expiry: row.ref.expiry, gas };
}
