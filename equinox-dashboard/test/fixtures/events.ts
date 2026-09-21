// test/fixtures/events.ts — umpan aktivitas sintetis: 8 event pool (Bought/Closed/Settled/Claimed lintas POOL_KEYS) + 7 Observed engine,
// label seri dari `seriesLabel` nyata (id JSON per pool), blok relatif terhadap DEPLOYED_AT_BLOCK. Hanya untuk test.
import { ALL_SERIES, DEPLOYED_AT_BLOCK, POOL_KEYS, WAD, type PoolKey } from '@chain/deployment';
import { seriesLabel, type EventSeed, type Events, type ObservedEvent, type TradeEvent } from '@chain/chain/events';
import { OWNER, USER } from './snapshot';

const hash = (n: number) => `0x${n.toString(16).padStart(64, 'a')}` as `0x${string}`;
const u6 = (x: bigint) => (Number(x) / 1e6).toFixed(2);
const w = (x: bigint) => (Number(x) / 1e18).toFixed(2);
const idxOf = (boardId: number, strike: number, isCall: boolean) => ALL_SERIES.findIndex((s) => s.boardId === boardId && s.strike === strike && s.isCall === isCall);

/** Spesifikasi 8 event, tertua dulu; pool diputar dari POOL_KEYS agar jumlahnya tetap 8 walau manifest hanya A/B. */
interface Spec { kind: TradeEvent['kind']; series: number; size: bigint; assets: bigint; sigma: bigint; who: `0x${string}` }
const SPECS: Spec[] = [
  { kind: 'Bought', series: idxOf(0, 2800, true), size: 5n * WAD, assets: 92_412_355n, sigma: 661_300_000_000_000_000n, who: OWNER },
  { kind: 'Bought', series: idxOf(0, 2400, false), size: WAD, assets: 8_034_112n, sigma: 661_300_000_000_000_000n, who: OWNER },
  { kind: 'Bought', series: idxOf(1, 2600, true), size: 10n ** 16n, assets: 1_258_407n, sigma: 740_000_000_000_000_000n, who: USER },
  { kind: 'Closed', series: idxOf(1, 2600, true), size: 10n ** 16n, assets: 993_533n, sigma: 600_000_000_000_000_000n, who: USER },
  { kind: 'Bought', series: idxOf(0, 2800, true), size: 5n * WAD, assets: 92_413_210n, sigma: 661_400_000_000_000_000n, who: OWNER },
  { kind: 'Bought', series: idxOf(0, 2400, false), size: WAD, assets: 8_034_190n, sigma: 661_400_000_000_000_000n, who: OWNER },
  { kind: 'Bought', series: idxOf(1, 3000, true), size: 10n ** 17n, assets: 412_118n, sigma: 700_000_000_000_000_000n, who: USER },
  { kind: 'Closed', series: idxOf(1, 3000, true), size: 10n ** 17n, assets: 380_004n, sigma: 590_000_000_000_000_000n, who: USER },
];

/** 8 trade (terbaru dulu, seperti readEvents/mergeEvents) — 2 blok per event mulai DEPLOYED_AT_BLOCK + 1000. */
export function liveTrades(): TradeEvent[] {
  return SPECS.map((sp, n) => {
    const k: PoolKey = POOL_KEYS[n % POOL_KEYS.length]!;
    const ref = ALL_SERIES[sp.series]!;
    const label = seriesLabel(k, ref.id[k]);
    // Format amount = events.ts (Bought: premi, Closed: proceeds — keduanya "units · USDG @ σ").
    const amount = `${w(sp.size)} units · ${u6(sp.assets)} USDG @ σ ${w(sp.sigma)}`;
    return { pool: k, kind: sp.kind, block: DEPLOYED_AT_BLOCK + 1_000n + BigInt(n) * 2_000n, logIndex: 3 + n, tx: hash(n + 1), who: sp.who, label, amount };
  }).reverse();
}
/** 7 Observed urut rantai: σ_base naik 0.52 → 0.5483, round Chainlink berurutan, harga 2 560 → 2 579. */
export function liveObserved(): ObservedEvent[] {
  const sigmas = [0.52, 0.528, 0.535, 0.541, 0.545, 0.547, 0.548348];
  const prices = [2560.1, 2563.8, 2559.2, 2566.4, 2571.9, 2574.27, 2579.49];
  return sigmas.map((sg, n) => ({
    block: DEPLOYED_AT_BLOCK + 500n + BigInt(n) * 2_500n, logIndex: 1, roundId: 18_446_744_073_710_941_817n + BigInt(n),
    priceWad: BigInt(Math.round(prices[n]! * 1e6)) * 10n ** 12n, sigmaBase: BigInt(Math.round(sg * 1e6)) * 10n ** 12n,
  }));
}
export function liveEvents(): Events { return { trades: liveTrades(), observed: liveObserved() }; }
/** Seed hasil build yang mencakup semua event di atas (lastBlock = blok tertinggi). */
export function liveSeed(): EventSeed {
  const e = liveEvents();
  const last = [...e.trades, ...e.observed].reduce((m, x) => (x.block > m ? x.block : m), DEPLOYED_AT_BLOCK);
  return { lastBlock: last, generatedAt: '2026-09-20T13:03:00.000Z', trades: e.trades, observed: e.observed };
}

/** Event Settled sintetis (tanpa pelaku) untuk board `boardId` di pool `k` — label & amount = format events.ts; blok setelah semua trade fixture. */
export function settledEvent(k: PoolKey, boardId: number, price: number, blockOffset = 0n): TradeEvent {
  const last = liveTrades()[0]!.block;
  return {
    pool: k, kind: 'Settled', block: last + 500n + blockOffset, logIndex: 7, tx: hash(90 + Number(blockOffset)), who: null,
    label: `board #${boardId}`, amount: `S_T ${price.toFixed(2)} · escrow +${(500).toFixed(2)} · reserved −${(16_400).toFixed(2)}`,
  };
}
/** Event Claimed sintetis oleh `who` di pool `k` untuk seri `series` (indeks ALL_SERIES). */
export function claimedEvent(k: PoolKey, series: number, who: `0x${string}`, blockOffset = 0n): TradeEvent {
  const last = liveTrades()[0]!.block;
  const ref = ALL_SERIES[series]!;
  return { pool: k, kind: 'Claimed', block: last + 800n + blockOffset, logIndex: 2, tx: hash(120 + Number(blockOffset)), who, label: seriesLabel(k, ref.id[k]), amount: `${w(5n * WAD)} units · payout ${u6(500_000_000n)} USDG` };
}
