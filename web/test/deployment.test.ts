// test/deployment.test.ts — bentuk manifest; bebas dari jumlah board (board 9/16 Okt ditambahkan setelah settlement pertama) dan jumlah pool (C opsional), spot check tetap pada board 0.
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, CHAIN_ID, DEPLOYED_AT, DEPLOYED_AT_BLOCK, GAS_KEYS, MATH_SOL, MATH_STYLUS, PAXOS_FAUCET, POOLS, POOL_KEYS, USDG, VOL } from '../src/deployment';
describe('deployment manifest', () => {
  it('is Arbitrum Sepolia with at least two boards of six series each on the Friday 08:00 UTC grid', () => {
    expect(CHAIN_ID).toBe(421614);
    expect(BOARDS.length).toBeGreaterThanOrEqual(2);
    for (const b of BOARDS) { expect(b.strikes).toHaveLength(3); for (const k of POOL_KEYS) expect(b.seriesIds[k], `board ${b.id} ids ${k}`).toHaveLength(6); expect((b.expiry - 115_200) % 604_800).toBe(0); }
    // Urutan board naik dan id = indeks (createBoard berurutan); strike naik & unik per board.
    BOARDS.forEach((b, i) => { expect(b.id).toBe(i); if (i > 0) expect(b.expiry).toBeGreaterThan(BOARDS[i - 1]!.expiry); expect([...b.strikes].sort((x, y) => x - y)).toEqual(b.strikes); expect(new Set(b.strikes).size).toBe(3); });
    expect(ALL_SERIES).toHaveLength(6 * BOARDS.length);
    // Urutan seri per board [C K0, P K0, C K1, P K1, C K2, P K2] dan id-nya = seriesIds[idx] pada tiap board.
    BOARDS.forEach((b, bi) => [0, 1, 2].forEach((si) => [true, false].forEach((isCall, c) => {
      const idx = 2 * si + c, s = ALL_SERIES[6 * bi + idx]!;
      expect(s).toMatchObject({ boardId: b.id, expiry: b.expiry, strike: b.strikes[si], isCall, idx });
      for (const k of POOL_KEYS) { expect(s.id[k], `${k} id`).toBeDefined(); expect(s.id[k]).toBe(b.seriesIds[k][idx]); }
    })));
    expect(ALL_SERIES[0]).toMatchObject({ boardId: 0, strike: 2400, isCall: true, idx: 0 });
    expect(ALL_SERIES[1]).toMatchObject({ strike: 2400, isCall: false, idx: 1 });
    expect(POOLS.A.pool).not.toBe(POOLS.B.pool);
    expect(VOL).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Pool dari manifest: kunci ⊆ {A, B, C} berurutan, A dan B wajib, gas/paritas selalu A vs B; aset per pool alamat valid — A/B = MockUSDG, C (bila ada) = USDG Paxos.
    expect(POOL_KEYS.every((k) => ['A', 'B', 'C'].includes(k))).toBe(true);
    expect(POOL_KEYS.slice(0, 2)).toEqual(['A', 'B']);
    expect(new Set(POOL_KEYS).size).toBe(POOL_KEYS.length);
    expect(Object.keys(POOLS)).toEqual(POOL_KEYS);
    expect([...GAS_KEYS]).toEqual(['A', 'B']);
    for (const k of POOL_KEYS) {
      for (const a of [POOLS[k].pool, POOLS[k].token, POOLS[k].math, POOLS[k].asset]) expect(a, `${k} address`).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(POOLS[k].assetSymbol).toBe('USDG'); expect(['mint', 'paxos']).toContain(POOLS[k].faucet); expect(POOLS[k].label).toMatch(new RegExp(`^Pool ${k} — `));
    }
    expect(POOLS.A.asset).toBe(USDG); expect(POOLS.B.asset).toBe(USDG); expect(POOLS.A.faucet).toBe('mint'); expect(POOLS.B.faucet).toBe('mint');
    expect(POOLS.A.math).toBe(MATH_SOL); expect(POOLS.B.math).toBe(MATH_STYLUS);
    if (POOL_KEYS.includes('C')) { expect(POOLS.C.faucet).toBe('paxos'); expect(POOLS.C.asset).not.toBe(USDG); expect(POOLS.C.math).toBe(POOLS.B.math); expect(POOLS.C.pool).not.toBe(POOLS.B.pool); }
    expect(PAXOS_FAUCET).toBe('https://faucet.paxos.com/');
    // Anchor deploy (blok + waktu unix dari `pools.deployedAt` ISO) untuk interpolasi "≈ waktu blok" di dashboard: keduanya positif dan sebelum board pertama.
    expect(DEPLOYED_AT_BLOCK).toBeGreaterThan(0n);
    expect(Number.isInteger(DEPLOYED_AT) && DEPLOYED_AT > 0).toBe(true);
    expect(DEPLOYED_AT).toBeLessThan(BOARDS[0]!.expiry);
  });
});
