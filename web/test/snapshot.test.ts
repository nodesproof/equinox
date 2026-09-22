// test/snapshot.test.ts — unit tanpa jaringan: `atmSeries` memilih C terdekat spot pada expiry terdekat yang belum blackout.
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, DEPLOYER, POOL_KEYS, WAD, type PoolKey } from '../src/deployment';
import { atmSeries, type PoolCfg, type PoolState, type SeriesRow, type SeriesState, type Snapshot } from '../src/chain/snapshot';
import { equinoxPoolAbi } from '../src/abi/equinoxPool';
import { equinoxVolEngineAbi } from '../src/abi/equinoxVolEngine';

const state = (settled = false): SeriesState => ({ oi: 0n, settled, payoutPerUnit: 0n, buy: null, buyError: null, close: null });
/** `cfg()` sintetis — urutan kunci = tuple ABI (diasersi di bawah); nilainya nol karena `atmSeries` tidak membacanya. */
const cfg = (): PoolCfg => ({ feeBps: 0, maxUtilBps: 0, vegaCapBps: 0, minPremiumBps: 0, heartbeat: 0, staleMult: 0, sequencerGrace: 0, maxOpenSeries: 0, tenorMax: 0, minSize: 0n, settleBounty: 0n });
const pool = (): PoolState => ({
  totalAssets: 0n, totalSupply: 0n, reserved: 0n, escrow: 0n, netVega: 0n, freeLiquidity: 0n, sigmaMarkNow: 0n, capitalRefPrev: 0n,
  tradingPaused: false, cash: 0n, owner: DEPLOYER, cfg: cfg(), boards: BOARDS.map(() => ({ settled: false, settlementPrice: 0n })),
});
/** Snapshot sintetis dari ALL_SERIES: hanya `series`, `blockTime`, `feed.spotWad` yang dibaca `atmSeries`; pool dan baris seri dibangun dari POOL_KEYS. */
const synthetic = (blockTime: number, spot: number, settledBoard: number | null = null): Snapshot => ({
  fetchedAtMs: 0, blockNumber: 0n, blockTime,
  feed: { answer: BigInt(spot) * 10n ** 8n, updatedAt: blockTime, spotWad: BigInt(spot) * WAD },
  vol: { sigmaBase: 0n, sigmaMark0: 0n, varWad: 0n, vrp: 0n, alpha: 0n, spread: 0n, lambdaPerDay: 0n, sigmaMin: 0n, sigmaMax: 0n, lastRoundId: 0n, lastTs: 0 },
  pools: Object.fromEntries(POOL_KEYS.map((k) => [k, pool()])) as Record<PoolKey, PoolState>,
  series: ALL_SERIES.map((ref) => ({ ref, ...Object.fromEntries(POOL_KEYS.map((k) => [k, state(ref.boardId === settledBoard)])) } as SeriesRow)),
  user: null,
});
// Semua dari BOARDS (manifest bisa bertambah board 9/16 Okt): expiry0/expiry1 = dua board pertama, lastExpiry = board terakhir.
const expiry0 = BOARDS[0]!.expiry, expiry1 = BOARDS[1]!.expiry, lastExpiry = Math.max(...BOARDS.map((b) => b.expiry));

describe('atmSeries', () => {
  it('picks the nearest-strike call on the nearest open board', () => {
    const snap = synthetic(expiry0 - 86_400, 2650);
    // Baris sintetis punya satu SeriesState per pool POOL_KEYS (bentuk `SeriesRow` = { ref } & Record<PoolKey, SeriesState>).
    for (const k of POOL_KEYS) { expect(snap.pools[k]).toBeDefined(); expect(snap.series[0]![k]).toMatchObject({ settled: false, oi: 0n }); }
    // `pools[k].cfg` memuat SEMUA output `cfg()` dengan nama & urutan ABI, dan `vol` memuat semua output `params()` + lastRoundId/lastTs —
    // UI membaca bps/ambang/parameter dari snapshot (bukan konstanta); drift ABI (field baru/berganti nama) terdeteksi di sini.
    const outputs = (abi: readonly { type: string; name?: string; outputs?: readonly { name: string }[] }[], fn: string) =>
      abi.find((f) => f.type === 'function' && f.name === fn)!.outputs!.map((o) => o.name);
    for (const k of POOL_KEYS) expect(Object.keys(snap.pools[k].cfg), `${k} cfg keys`).toEqual(outputs(equinoxPoolAbi, 'cfg'));
    expect(outputs(equinoxPoolAbi, 'cfg')).toHaveLength(11);
    for (const name of outputs(equinoxVolEngineAbi, 'params')) expect(snap.vol, `vol.${name}`).toHaveProperty(name);
    for (const name of ['sigmaBase', 'sigmaMark0', 'varWad', 'lastRoundId', 'lastTs']) expect(snap.vol, `vol.${name}`).toHaveProperty(name);
    const r = atmSeries(snap);
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
    expect(atmSeries(synthetic(lastExpiry + 1, 2650))).toBeNull();
    expect(atmSeries(synthetic(lastExpiry - 30, 2650))).toBeNull(); // blackout 60 s pada board terakhir pun
  });
});
