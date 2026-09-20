// events.ts — umpan aktivitas: event pool (Bought/Closed/Settled/Claimed) di kedua pool + Observed dari engine vol bersama.
import { parseAbiItem, type Address } from 'viem';
import type { Client } from './client';
import { ALL_SERIES, DEPLOYED_AT_BLOCK, POOLS, POOL_KEYS, VOL, type PoolKey } from '../deployment';

export interface TradeEvent {
  pool: PoolKey; kind: 'Bought' | 'Closed' | 'Settled' | 'Claimed'; block: bigint; logIndex: number; tx: `0x${string}`;
  who: Address | null; label: string; amount: string;
}
export interface ObservedEvent { block: bigint; logIndex: number; roundId: bigint; priceWad: bigint; sigmaBase: bigint }
export interface Events { trades: TradeEvent[]; observed: ObservedEvent[] }

// Tanda tangan sama persis dengan ABI hasil generate (abi/equinoxPool.ts, abi/equinoxVolEngine.ts).
const EV = {
  Bought: parseAbiItem('event Bought(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 premiumAssets, uint256 feeAssets, uint256 sigmaBuy, uint256 spotWad)'),
  Closed: parseAbiItem('event Closed(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad)'),
  Settled: parseAbiItem('event Settled(uint256 indexed boardId, uint256 settlementPriceWad, uint256 escrowedAddedWad, uint256 reservedReleasedWad)'),
  Claimed: parseAbiItem('event Claimed(uint256 indexed seriesId, address indexed holder, uint256 amount, uint256 payoutAssets)'),
  Observed: parseAbiItem('event Observed(uint80 indexed roundId, uint256 priceWad, uint256 dtSeconds, uint256 varWad, uint256 sigmaBase)'),
};
/** Lebar jendela eth_getLogs. RPC publik Sepolia menerima 50k blok dalam ~0,3 s; rentang jauh lebih lebar lambat/ditolak 429. */
export const CHUNK = 50_000n;

/** Label seri dari id JSON: `C 2800 #0`; id yang tidak dikenal → potongan angka pertamanya. */
export const seriesLabel = (k: PoolKey, id: bigint) => {
  const s = ALL_SERIES.find((x) => x.id[k] === id);
  return s ? `${s.isCall ? 'C' : 'P'} ${s.strike} #${s.boardId}` : `series ${id.toString().slice(0, 8)}…`;
};
const u = (x: bigint) => (Number(x) / 1e6).toFixed(2);   // USDG 6 dp
const w = (x: bigint) => (Number(x) / 1e18).toFixed(2);  // WAD

/** Memanggil `fn` per jendela CHUNK blok, batas inklusif di kedua sisi; from > to → tidak ada panggilan. */
export async function chunked<T>(from: bigint, to: bigint, fn: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let a = from; a <= to; a += CHUNK) {
    const b = a + CHUNK - 1n < to ? a + CHUNK - 1n : to;
    out.push(...(await fn(a, b)));
  }
  return out;
}

/** Terbaru dulu: blok turun, lalu logIndex turun di blok yang sama. */
const newestFirst = (a: { block: bigint; logIndex: number }, b: { block: bigint; logIndex: number }) =>
  a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1;
const oldestFirst = (a: { block: bigint; logIndex: number }, b: { block: bigint; logIndex: number }) => -newestFirst(a, b);

export async function readEvents(client: Client, toBlock: bigint, fromBlock: bigint = DEPLOYED_AT_BLOCK): Promise<Events> {
  // Tiga alamat dibaca paralel (2 pool + engine); tiap alamat berjalan berurutan per jendela CHUNK.
  const [perPool, obs] = await Promise.all([
    Promise.all(POOL_KEYS.map(async (k): Promise<TradeEvent[]> => {
      const logs = await chunked(fromBlock, toBlock, (a, b) =>
        client.getLogs({ address: POOLS[k].pool, events: [EV.Bought, EV.Closed, EV.Settled, EV.Claimed], fromBlock: a, toBlock: b }));
      return logs.map((l) => {
        // viem mengetik `args` sebagai union empat objek parsial (decode non-strict); record longgar lebih ringkas daripada narrowing per event.
        const args = l.args as Record<string, bigint | Address | undefined>;
        const e = l.eventName as TradeEvent['kind'];
        const row: TradeEvent = { pool: k, kind: e, block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash, who: (args.trader ?? args.holder ?? null) as Address | null, label: '', amount: '' };
        if (e === 'Bought') { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.size as bigint)} units · ${u(args.premiumAssets as bigint)} USDG @ σ ${w(args.sigmaBuy as bigint)}`; }
        else if (e === 'Closed') { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.size as bigint)} units · ${u(args.proceedsAssets as bigint)} USDG @ σ ${w(args.sigmaClose as bigint)}`; }
        else if (e === 'Settled') { row.label = `board #${args.boardId}`; row.amount = `S_T ${w(args.settlementPriceWad as bigint)} · escrow +${w(args.escrowedAddedWad as bigint)} · reserved −${w(args.reservedReleasedWad as bigint)}`; }
        else { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.amount as bigint)} units · payout ${u(args.payoutAssets as bigint)} USDG`; }
        return row;
      });
    })),
    chunked(fromBlock, toBlock, (a, b) => client.getLogs({ address: VOL, event: EV.Observed, fromBlock: a, toBlock: b })),
  ]);
  const trades = perPool.flat().sort(newestFirst);
  // Observed dibiarkan urut rantai (tertua dulu) — sumbu x grafik = urutan observasi.
  const observed: ObservedEvent[] = obs.map((l) => ({ block: l.blockNumber, logIndex: l.logIndex, roundId: l.args.roundId!, priceWad: l.args.priceWad!, sigmaBase: l.args.sigmaBase! }));
  return { trades, observed };
}

/**
 * Gabungan hasil inkremental: dedupe per (tx, logIndex) — observed tanpa tx memakai (blok, logIndex), unik di satu blok.
 * Pada tabrakan kunci `next` (pembacaan terbaru) menang untuk trades DAN observed: pembacaan terbaru mencerminkan rantai kanonis saat ini,
 * sedangkan `prev` bisa berasal dari seed hasil build yang lebih tua. Trades terbaru dulu, observed urut rantai.
 */
export function mergeEvents(prev: Events, next: Events): Events {
  const key = (e: { tx?: string; block: bigint; logIndex: number }) => `${e.tx ?? e.block}:${e.logIndex}`;
  const dedupe = <T extends { block: bigint; logIndex: number; tx?: string }>(xs: T[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  return {
    trades: dedupe([...next.trades, ...prev.trades]).sort(newestFirst),
    observed: dedupe([...next.observed, ...prev.observed]).sort(oldestFirst),
  };
}

// --- Seed hasil build: public/events-seed.json, ditulis scripts/seed-events.ts saat build dan dibaca main.ts sebelum poll dimulai. ---
export interface EventSeed { lastBlock: bigint; generatedAt: string; trades: TradeEvent[]; observed: ObservedEvent[] }

/** JSON tidak punya bigint: bigint → string desimal; `logIndex` tetap number. Pasangan serialize/parse ini dipakai penulis DAN pembaca agar tidak drift. */
export function serializeSeed(seed: EventSeed): string {
  return JSON.stringify(seed, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}
type Raw = Record<string, unknown>;
export function parseSeed(json: string): EventSeed {
  const o = JSON.parse(json) as Raw;
  if (typeof o.lastBlock !== 'string' || typeof o.generatedAt !== 'string' || !Array.isArray(o.trades) || !Array.isArray(o.observed)) throw new Error('seed: unexpected shape');
  const big = (v: unknown, what: string) => { if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error(`seed: ${what} is not a decimal string`); return BigInt(v); };
  const num = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`seed: ${what} is not an integer`); return v; };
  return {
    lastBlock: big(o.lastBlock, 'lastBlock'), generatedAt: o.generatedAt,
    trades: (o.trades as Raw[]).map((t): TradeEvent => ({
      pool: t.pool as PoolKey, kind: t.kind as TradeEvent['kind'], block: big(t.block, 'trades[].block'), logIndex: num(t.logIndex, 'trades[].logIndex'),
      tx: t.tx as `0x${string}`, who: (t.who ?? null) as Address | null, label: String(t.label), amount: String(t.amount),
    })),
    observed: (o.observed as Raw[]).map((x): ObservedEvent => ({
      block: big(x.block, 'observed[].block'), logIndex: num(x.logIndex, 'observed[].logIndex'),
      roundId: big(x.roundId, 'observed[].roundId'), priceWad: big(x.priceWad, 'observed[].priceWad'), sigmaBase: big(x.sigmaBase, 'observed[].sigmaBase'),
    })),
  };
}

/**
 * Seed dari `${BASE_URL}events-seed.json` — halaman dilayani di /equinox/ (dev maupun Pages), jadi `/events-seed.json` polos akan 404.
 * Kegagalan apa pun (404, JSON rusak, jaringan) → null = pemindaian penuh. Seed dari deployment lain (lastBlock sebelum blok deploy) juga ditolak.
 */
export async function loadSeed(fetchFn: typeof fetch = fetch): Promise<EventSeed | null> {
  try {
    const res = await fetchFn(`${import.meta.env.BASE_URL}events-seed.json`);
    if (!res.ok) return null;
    const seed = parseSeed(await res.text());
    return seed.lastBlock < DEPLOYED_AT_BLOCK ? null : seed;
  } catch {
    return null;
  }
}
