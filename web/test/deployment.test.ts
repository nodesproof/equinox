// test/deployment.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, CHAIN_ID, POOLS, VOL } from '../src/deployment';
describe('deployment manifest', () => {
  it('is Arbitrum Sepolia with two boards of six series each', () => {
    expect(CHAIN_ID).toBe(421614);
    expect(BOARDS).toHaveLength(2);
    for (const b of BOARDS) { expect(b.strikes).toHaveLength(3); expect(b.seriesIds.A).toHaveLength(6); expect(b.seriesIds.B).toHaveLength(6); expect((b.expiry - 115_200) % 604_800).toBe(0); }
    expect(ALL_SERIES).toHaveLength(12);
    expect(ALL_SERIES[0]).toMatchObject({ boardId: 0, strike: 2400, isCall: true, idx: 0 });
    expect(ALL_SERIES[1]).toMatchObject({ strike: 2400, isCall: false, idx: 1 });
    expect(POOLS.A.pool).not.toBe(POOLS.B.pool);
    expect(VOL).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
