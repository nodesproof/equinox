// test/deployment.test.ts — bentuk manifest; bebas dari jumlah board (board 9/16 Okt ditambahkan setelah settlement pertama), spot check tetap pada board 0.
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, CHAIN_ID, POOLS, VOL } from '../src/deployment';
describe('deployment manifest', () => {
  it('is Arbitrum Sepolia with at least two boards of six series each on the Friday 08:00 UTC grid', () => {
    expect(CHAIN_ID).toBe(421614);
    expect(BOARDS.length).toBeGreaterThanOrEqual(2);
    for (const b of BOARDS) { expect(b.strikes).toHaveLength(3); expect(b.seriesIds.A).toHaveLength(6); expect(b.seriesIds.B).toHaveLength(6); expect((b.expiry - 115_200) % 604_800).toBe(0); }
    // Urutan board naik dan id = indeks (createBoard berurutan); strike naik & unik per board.
    BOARDS.forEach((b, i) => { expect(b.id).toBe(i); if (i > 0) expect(b.expiry).toBeGreaterThan(BOARDS[i - 1]!.expiry); expect([...b.strikes].sort((x, y) => x - y)).toEqual(b.strikes); expect(new Set(b.strikes).size).toBe(3); });
    expect(ALL_SERIES).toHaveLength(6 * BOARDS.length);
    // Urutan seri per board [C K0, P K0, C K1, P K1, C K2, P K2] dan id-nya = seriesIds[idx] pada tiap board.
    BOARDS.forEach((b, bi) => [0, 1, 2].forEach((si) => [true, false].forEach((isCall, c) => {
      const idx = 2 * si + c, s = ALL_SERIES[6 * bi + idx]!;
      expect(s).toMatchObject({ boardId: b.id, expiry: b.expiry, strike: b.strikes[si], isCall, idx });
      expect(s.id.A).toBe(b.seriesIds.A[idx]); expect(s.id.B).toBe(b.seriesIds.B[idx]);
    })));
    expect(ALL_SERIES[0]).toMatchObject({ boardId: 0, strike: 2400, isCall: true, idx: 0 });
    expect(ALL_SERIES[1]).toMatchObject({ strike: 2400, isCall: false, idx: 1 });
    expect(POOLS.A.pool).not.toBe(POOLS.B.pool);
    expect(VOL).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
