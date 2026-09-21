// activity.ts — helper murni halaman Activity: filter umpan event (pool / jenis / milik akun), perkiraan waktu blok untuk garis waktu σ_base
// (interpolasi linear dua anchor: blok/waktu deploy manifest ↔ blok/waktu snapshot), penanda Settled pada grafik, dan kalimat status pindaian
// per `eventsState` (+ tanggal seed hasil build). Tidak ada angka rantai yang ditanam: pool dari POOL_KEYS, jenis event dari tipe `TradeEvent`,
// jendela pindaian dari `EVENTS_EVERY`/`CHUNK` data layer, anchor deploy dari manifest (`DEPLOYED_AT_BLOCK`/`DEPLOYED_AT`).
import type { Address } from 'viem';
import { DEPLOYED_AT, DEPLOYED_AT_BLOCK, POOL_KEYS, type PoolKey } from '@chain/deployment';
import { CHUNK, type TradeEvent } from '@chain/chain/events';
import { utc } from '@chain/ui/format';
import { EVENTS_EVERY } from '@/chain/provider';
import type { EventsState, SeedMeta } from '@/chain/types';
import type { ChartMarker } from '@/components/SigmaChart';

export type EventKind = TradeEvent['kind'];
/** Urutan chip jenis = urutan event di ABI pool (Bought, Closed, Settled, Claimed). */
export const EVENT_KINDS: EventKind[] = ['Bought', 'Closed', 'Settled', 'Claimed'];

// ---------------------------------------------------------------- filter

export interface EventFilter {
  /** null = semua pool di POOL_KEYS. */
  pool: PoolKey | null;
  /** null = semua jenis. */
  kind: EventKind | null;
  /** Hanya event yang pelakunya (trader/holder) = akun terhubung; Settled tidak punya pelaku sehingga tersaring. */
  mine: boolean;
}
export const DEFAULT_EVENT_FILTER: EventFilter = { pool: null, kind: null, mine: false };
export const isDefaultFilter = (f: EventFilter) => f.pool === null && f.kind === null && !f.mine;

/** Pelaku event = akun (case-insensitive); false untuk Settled (`who` null) dan tanpa akun. */
export const isMine = (t: TradeEvent, account: Address | null) => account !== null && t.who !== null && t.who.toLowerCase() === account.toLowerCase();

export function filterTrades(trades: TradeEvent[], f: EventFilter, account: Address | null): TradeEvent[] {
  return trades.filter((t) => (f.pool === null || t.pool === f.pool) && (f.kind === null || t.kind === f.kind) && (!f.mine || isMine(t, account)));
}
/** Pool chip yang valid: pool dari kueri/klik hanya bila ada di manifest. */
export const poolOrNull = (v: string | null): PoolKey | null => POOL_KEYS.find((k) => k === v) ?? null;

// ---------------------------------------------------------------- waktu blok (perkiraan)

/** Waktu blok Arbitrum Nitro nominal ≈ 0,25 s (≈ 4 blok/s) — hanya CADANGAN bila kedua anchor tidak bisa dipakai (snapshot di/sebelum blok deploy). */
export const NITRO_BLOCK_S = 0.25;
/** Detik per blok dari dua anchor: (blok deploy, `deployedAt` manifest) ↔ (blok snapshot, `blockTime`) — laju nyata rentang itu (≈ 0,2505 s/blok pada
 *  26 jam pertama deployment ini, bukan 0,25 tepat: selisih 18 menit di blok deploy dengan laju tetap). Cadangan NITRO_BLOCK_S bila rentang ≤ 0 atau tidak wajar. */
export function secondsPerBlock(snapshotBlock: bigint, blockTime: number): number {
  const blocks = Number(snapshotBlock - DEPLOYED_AT_BLOCK), seconds = blockTime - DEPLOYED_AT;
  return blocks > 0 && seconds > 0 ? seconds / blocks : NITRO_BLOCK_S;
}
/** Perkiraan unix time (s) sebuah blok: interpolasi/ekstrapolasi linear dari blok snapshot dengan laju `secondsPerBlock` (dua anchor) — tepat pada
 *  kedua anchor (blok snapshot → `blockTime`, blok deploy → `DEPLOYED_AT`), selalu ditampilkan dengan "≈" (bukan timestamp rantai). */
export const blockTimeApprox = (block: bigint, snapshotBlock: bigint, blockTime: number): number =>
  blockTime - Number(snapshotBlock - block) * secondsPerBlock(snapshotBlock, blockTime);
/** Kalimat legenda/tooltip yang menyebut perkiraannya. */
export const TIME_APPROX_NOTE = `≈ time = linear interpolation between two anchors — the deploy block (block ${DEPLOYED_AT_BLOCK} at ${utc(DEPLOYED_AT)}, from the manifest) and the snapshot block time — an approximation, not a chain timestamp`;

// ---------------------------------------------------------------- penanda Settled

/** Satu penanda per event Settled (per pool; A/B/C men-settle board yang sama dalam beberapa blok berbeda), urut rantai. */
export function settledMarkers(trades: TradeEvent[]): ChartMarker[] {
  return trades.filter((t) => t.kind === 'Settled')
    .map((t): ChartMarker => ({ block: t.block, label: `settled ${t.label} · ${t.pool}`, title: `Pool ${t.pool} ${t.label} settled at block ${t.block} · ${t.amount}` }))
    .sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? -1 : 1));
}

// ---------------------------------------------------------------- kalimat status pindaian

/** Tanggal & blok seed hasil build: "generated 2026-09-20 13:03 UTC · to block N" (generatedAt ISO dari `scripts/seed-events.ts`). */
export const seedNote = (seed: SeedMeta) => `generated ${utc(Math.floor(Date.parse(seed.generatedAt) / 1000))} · to block ${seed.lastBlock}`;
/** Kalimat status umpan (kaki tabel): seed (dengan tanggal & blok terakhirnya bila metadata ada) / pindaian berjalan / live / gagal. */
export function scanNote(state: EventsState, loaded: number, seed: SeedMeta | null = null): string {
  switch (state) {
    case 'seed': return loaded ? `build-time seed loaded${seed ? ` (${seedNote(seed)})` : ''} · chain scan pending (runs after the first snapshot)` : 'no seed · chain scan pending (runs after the first snapshot)';
    case 'scanning': return `scanning eth_getLogs in ${CHUNK.toLocaleString('en-US')}-block windows…`;
    case 'live': return `chain scan live · re-read every ${EVENTS_EVERY}th snapshot`;
    case 'error': return 'chain scan failed — retrying at the next refresh';
  }
}
/** "N events since deploy" / "n of N events since deploy" (filter aktif). */
export const countNote = (shown: number, total: number) => (shown === total ? `${total} ${total === 1 ? 'event' : 'events'} since deploy` : `${shown} of ${total} events since deploy`);
