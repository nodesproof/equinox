// test/seriesId.test.ts — id di JSON == keccak256(abi.encode(pool, expiry, strike, isCall)) untuk semua seri di setiap pool POOL_KEYS (id C dari manifest atau diturunkan).
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, POOLS, POOL_KEYS, WAD, seriesId } from '../src/deployment';
describe('series ids', () => {
  it('match the on-chain derivation for every series of every pool', () => {
    expect(POOL_KEYS.length).toBeGreaterThanOrEqual(2);
    for (const s of ALL_SERIES) {
      for (const k of POOL_KEYS) expect(seriesId(POOLS[k].pool, s.expiry, BigInt(s.strike) * WAD, s.isCall), `${k} ${s.strike}${s.isCall ? 'C' : 'P'} #${s.boardId}`).toBe(s.id[k]);
      // Id berbeda antar pool (alamat pool ikut di-hash) — tidak ada tabrakan id lintas pool.
      expect(new Set(POOL_KEYS.map((k) => s.id[k])).size).toBe(POOL_KEYS.length);
    }
  });
});
