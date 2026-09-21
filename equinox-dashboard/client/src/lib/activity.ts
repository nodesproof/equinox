// activity.ts — helper murni halaman Activity: filter umpan event (pool / jenis / milik akun), perkiraan waktu blok untuk garis waktu σ_base,
// penanda Settled pada grafik, dan kalimat status pindaian per `eventsState`. Tidak ada angka rantai yang ditanam: pool dari POOL_KEYS,
// jenis event dari tipe `TradeEvent`, jendela pindaian dari `EVENTS_EVERY`/`CHUNK` data layer.
import type { Address } from 'viem';
import { POOL_KEYS, type PoolKey } from '@chain/deployment';
import { CHUNK, type TradeEvent } from '@chain/chain/events';
import { EVENTS_EVERY } from '@/chain/provider';
import type { EventsState } from '@/chain/types';
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

/** Waktu blok Arbitrum Nitro ≈ 0,25 s (≈ 4 blok/s) — PERKIRAAN untuk label garis waktu, bukan data rantai; selalu ditampilkan dengan "≈". */
export const NITRO_BLOCK_S = 0.25;
/** Perkiraan unix time (s) sebuah blok relatif terhadap blok snapshot: `blockTime − (snapshotBlock − block) × 0.25 s` (brief Task 6). */
export const blockTimeApprox = (block: bigint, snapshotBlock: bigint, blockTime: number): number => blockTime - Number(snapshotBlock - block) * NITRO_BLOCK_S;
/** Kalimat legenda/tooltip yang menyebut perkiraannya. */
export const TIME_APPROX_NOTE = `≈ time = snapshot block time − blocks behind × ${NITRO_BLOCK_S} s (Nitro ≈ ${Math.round(1 / NITRO_BLOCK_S)} blocks/s — an approximation, not a chain timestamp)`;

// ---------------------------------------------------------------- penanda Settled

/** Satu penanda per event Settled (per pool; A/B/C men-settle board yang sama dalam beberapa blok berbeda), urut rantai. */
export function settledMarkers(trades: TradeEvent[]): ChartMarker[] {
  return trades.filter((t) => t.kind === 'Settled')
    .map((t): ChartMarker => ({ block: t.block, label: `settled ${t.label} · ${t.pool}`, title: `Pool ${t.pool} ${t.label} settled at block ${t.block} · ${t.amount}` }))
    .sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? -1 : 1));
}

// ---------------------------------------------------------------- kalimat status pindaian

/** Kalimat status umpan (kaki tabel): seed / pindaian berjalan / live / gagal — tanpa tanggal seed (metadata seed tidak diekspos provider). */
export function scanNote(state: EventsState, loaded: number): string {
  switch (state) {
    case 'seed': return loaded ? 'build-time seed loaded · chain scan pending (runs after the first snapshot)' : 'no seed · chain scan pending (runs after the first snapshot)';
    case 'scanning': return `scanning eth_getLogs in ${CHUNK.toLocaleString('en-US')}-block windows…`;
    case 'live': return `chain scan live · re-read every ${EVENTS_EVERY}th snapshot`;
    case 'error': return 'chain scan failed — retrying at the next refresh';
  }
}
/** "N events since deploy" / "n of N events since deploy" (filter aktif). */
export const countNote = (shown: number, total: number) => (shown === total ? `${total} ${total === 1 ? 'event' : 'events'} since deploy` : `${shown} of ${total} events since deploy`);
