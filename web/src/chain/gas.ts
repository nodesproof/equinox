// gas.ts — estimasi gas `buy(id, 1, max)` dari wallet owner (punya USDG + allowance) untuk seri ATM, A vs B.
import type { Client } from './client';
import { POOLS, POOL_KEYS, type PoolKey } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { atmSeries, type Snapshot } from './snapshot';
const MAX = 2n ** 256n - 1n;
export interface GasEstimate { strike: number; expiry: number; gas: Record<PoolKey, bigint | null> }
export async function readGas(client: Client, s: Snapshot): Promise<GasEstimate | null> {
  const row = atmSeries(s); if (!row) return null;
  const gas = { A: null as bigint | null, B: null as bigint | null };
  await Promise.all(POOL_KEYS.map(async (k) => {
    try { gas[k] = await client.estimateContractGas({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'buy', args: [row.ref.id[k], 10n ** 18n, MAX], account: s.pools[k].owner }); }
    catch { gas[k] = null; }
  }));
  return { strike: row.ref.strike, expiry: row.ref.expiry, gas };
}
