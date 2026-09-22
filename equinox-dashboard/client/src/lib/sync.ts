// sync.ts — status sinkronisasi snapshot (connecting | failed | live | stale) dan teks banner RPC, dihitung MURNI dari
// ChainState + jam useNow() (bukan meta.nowMs) — dipakai badge sidebar/topbar dan RpcBanner agar ketiganya selalu sepakat.
import { STALE_MS, isStale, nextDelayMs, pollBaseMs } from '@chain/ui/poll';
import { rpcBanner } from '@/chain/selectors';
import type { ChainState } from '@/chain/types';

export type SyncKind = 'connecting' | 'failed' | 'live' | 'stale';
export interface SyncStatus {
  kind: SyncKind;
  /** Teks badge: `connecting` sebelum snapshot pertama, `live`/`stale` sesudahnya, `RPC error` bila muat pertama gagal. */
  label: string;
  /** Umur snapshot terakhir yang sukses (detik); null sebelum snapshot pertama. */
  ageS: number | null;
  /** Pesan RPC terakhir (data lama tetap tampil); null bila refresh terakhir sukses. */
  error: string | null;
}

/** Header klasik: `connecting` tanpa snapshot; `stale` bila umur data > STALE_MS (`isStale`); selain itu `live`. Muat pertama gagal → `failed` (state retry §8.2). */
export function syncStatus(state: Pick<ChainState, 'snapshot' | 'meta'>, nowMs: number): SyncStatus {
  const { snapshot, meta } = state;
  if (snapshot === null) {
    return meta.error === null ? { kind: 'connecting', label: 'connecting', ageS: null, error: null } : { kind: 'failed', label: 'RPC error', ageS: null, error: meta.error };
  }
  const lastOk = meta.lastOkMs ?? snapshot.fetchedAtMs;
  const stale = isStale(lastOk, nowMs);
  return { kind: stale ? 'stale' : 'live', label: stale ? 'stale' : 'live', ageS: Math.max(0, (nowMs - lastOk) / 1000), error: meta.error };
}

export type BannerTone = 'warn' | 'bad';
export interface BannerModel { tone: BannerTone; title: string; detail: string }

/** HH:MM:SS UTC dari ms epoch — format yang sama dengan `rpcBanner` (brief §5). */
export const hms = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)} UTC`;
/** Kalimat back-off dari `nextDelayMs` (15 s → 30 s → 60 s pada interval dasar; mengikuti `?poll=`), bukan angka yang ditanam. */
const backoff = () => { const base = pollBaseMs(); return `polling backs off to ${nextDelayMs(1, base) / 1000} s then ${nextDelayMs(2, base) / 1000} s`; };

/**
 * Banner RPC (brief §5/§8.2), null bila tidak ada yang perlu dilaporkan:
 * - muat pertama gagal → "RPC error on first load — retrying" (merah, tombol retry);
 * - RPC gagal tetapi masih ada data lama → teks `rpcBanner` "RPC unreachable — showing data fetched HH:MM:SS UTC" (data tetap di layar);
 * - tidak ada error tetapi snapshot > STALE_MS (refresh menggantung) → "Snapshot is stale".
 */
export function bannerModel(state: Pick<ChainState, 'snapshot' | 'meta'>, nowMs: number): BannerModel | null {
  const { snapshot, meta } = state;
  const status = syncStatus(state, nowMs);
  if (status.kind === 'failed') {
    return { tone: 'bad', title: 'RPC error on first load — retrying', detail: `${meta.error} · ${backoff()}; nothing on this page is fabricated while the chain is unreachable.` };
  }
  if (snapshot === null) return null;
  const unreachable = rpcBanner(state);
  if (unreachable !== null) {
    return { tone: 'warn', title: unreachable, detail: `${meta.error} · block ${snapshot.blockNumber} stays on screen; ${backoff()}.` };
  }
  if (status.kind === 'stale') {
    return { tone: 'warn', title: `Snapshot is stale — last good data fetched ${hms(meta.lastOkMs ?? snapshot.fetchedAtMs)}`, detail: `No new block-pinned snapshot for over ${STALE_MS / 1000} s; block ${snapshot.blockNumber} stays on screen until the RPC answers.` };
  }
  return null;
}
