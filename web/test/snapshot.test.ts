// test/snapshot.test.ts — unit tanpa jaringan: `atmSeries` memilih C terdekat spot pada expiry terdekat yang belum blackout.
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, DEPLOYER, WAD } from '../src/deployment';
import { atmSeries, type PoolState, type SeriesState, type Snapshot } from '../src/chain/snapshot';

const state = (settled = false): SeriesState => ({ oi: 0n, settled, payoutPerUnit: 0n, buy: null, buyError: null, close: null });
const pool = (): PoolState => ({
  totalAssets: 0n, totalSupply: 0n, reserved: 0n, escrow: 0n, netVega: 0n, freeLiquidity: 0n, sigmaMarkNow: 0n, capitalRefPrev: 0n,
  tradingPaused: false, cash: 0n, owner: DEPLOYER, boards: BOARDS.map(() => ({ settled: false, settlementPrice: 0n })),
});
/** Snapshot sintetis dari ALL_SERIES: hanya `series`, `blockTime`, `feed.spotWad` yang dibaca `atmSeries`. */
const synthetic = (blockTime: number, spot: number, settledBoard: number | null = null): Snapshot => ({
  fetchedAtMs: 0, blockNumber: 0n, blockTime,
  feed: { answer: BigInt(spot) * 10n ** 8n, updatedAt: blockTime, spotWad: BigInt(spot) * WAD },
  vol: { sigmaBase: 0n, sigmaMark0: 0n, varWad: 0n, vrp: 0n, alpha: 0n, spread: 0n },
  pools: { A: pool(), B: pool() },
  series: ALL_SERIES.map((ref) => ({ ref, A: state(ref.boardId === settledBoard), B: state(ref.boardId === settledBoard) })),
  user: null,
});
const expiry0 = BOARDS[0]!.expiry, expiry1 = BOARDS[1]!.expiry;

describe('atmSeries', () => {
  it('picks the nearest-strike call on the nearest open board', () => {
    const r = atmSeries(synthetic(expiry0 - 86_400, 2650));
    expect(r?.ref).toMatchObject({ boardId: 0, strike: 2600, isCall: true });
  });
  it('skips a board inside the 60 s blackout and falls through to the next one', () => {
    const r = atmSeries(synthetic(expiry0 - 30, 2650));
    expect(r?.ref).toMatchObject({ boardId: 1, strike: 2600, isCall: true });
  });
  it('skips a settled board and never returns a put', () => {
    const r = atmSeries(synthetic(expiry0 - 86_400, 2650, 0));
    expect(r?.ref).toMatchObject({ boardId: 1, isCall: true });
    expect(r?.ref.expiry).toBe(expiry1);
    const far = atmSeries(synthetic(expiry0 - 86_400, 3100));
    expect(far?.ref).toMatchObject({ boardId: 0, strike: 2800, isCall: true });
  });
  it('returns null when every board is expired', () => {
    expect(atmSeries(synthetic(expiry1 + 1, 2650))).toBeNull();
  });
});
