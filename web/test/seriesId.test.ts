// test/seriesId.test.ts — id di JSON == keccak256(abi.encode(pool, expiry, strike, isCall)) untuk semua 24 seri
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, POOLS, WAD, seriesId } from '../src/deployment';
describe('series ids', () => {
  it('match the on-chain derivation for every series of both pools', () => {
    for (const s of ALL_SERIES) {
      expect(seriesId(POOLS.A.pool, s.expiry, BigInt(s.strike) * WAD, s.isCall)).toBe(s.id.A);
      expect(seriesId(POOLS.B.pool, s.expiry, BigInt(s.strike) * WAD, s.isCall)).toBe(s.id.B);
    }
  });
});
