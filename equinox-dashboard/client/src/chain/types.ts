// types.ts — bentuk state chain yang dibagikan ChainProvider ke seluruh halaman (satu sumber kebenaran per refresh, brief §5).
import type { Address } from 'viem';
import type { Client } from '@chain/chain/client';
import type { Snapshot } from '@chain/chain/snapshot';
import type { ParityRow } from '@chain/chain/parity';
import type { GasEstimate } from '@chain/chain/gas';
import type { Events } from '@chain/chain/events';
import type { TradeCall } from '@chain/chain/trade';
import type { PoolKey } from '@chain/deployment';

/** Metadata refresh: `nowMs` berdetak tiap 1 s; `lastOkMs` = snapshot sukses terakhir; `error` = pesan RPC terakhir (data lama tetap dipertahankan);
 *  `stale` = ada data dan umurnya > 60 s (`isStale`); `refreshes` = jumlah snapshot yang berhasil sejak mount. */
export interface Meta { nowMs: number; lastOkMs: number | null; error: string | null; stale: boolean; refreshes: number }

/** Satu baris log transaksi. `ok === null` = masih berjalan (simulate → wallet → receipt); `hash` ada juga untuk tx yang terkirim lalu gagal (TxFailed). */
export interface TxEntry { id: number; ok: boolean | null; what: string; tail: string; hash?: `0x${string}`; atMs: number }

/** Status umpan event: `seed` = hanya seed hasil build (atau kosong) sebelum pindaian rantai pertama selesai; `scanning` = pembacaan eth_getLogs sedang
 *  berjalan (pindaian pertama tanpa seed bisa lama); `live` = pembacaan terakhir sukses sampai blok snapshot; `error` = pembacaan terakhir gagal (data lama dipertahankan, dicoba lagi). */
export type EventsState = 'seed' | 'scanning' | 'live' | 'error';

/** Pembangun panggilan tulis: menerima pool & akun yang ditangkap saat klik (brief §5), boleh async (membaca kuotasi/simulasi segar sebelum menulis). */
export type BuildCall = (k: PoolKey, acct: Address) => Promise<TradeCall> | TradeCall;

export interface ChainState {
  /** Client viem yang dipakai provider (bisa di-inject untuk test); dipakai juga untuk pratinjau `readContract` di useTrade. */
  client: Client;
  snapshot: Snapshot | null;
  meta: Meta;
  parity: ParityRow[];
  gas: GasEstimate | null;
  events: Events;
  eventsState: EventsState;
  account: Address | null;
  wrongChain: boolean;
  hasWallet: boolean;
  busy: boolean;
  txLog: TxEntry[];
  /** Refresh segera (setelah connect / aksi): bila ada refresh berjalan, jalankan lagi sesudahnya agar akun & saldo terbaru terbaca. */
  refreshNow(): void;
  /** Connect wallet (atau pindah chain bila sudah connect tapi salah jaringan); kegagalan dicatat ke `txLog` sebagai `✗ connect`. */
  connect(): Promise<void>;
  /** Satu aksi tulis: guard `busy` → `write(await build(k, acct), acct)` → catat ke `txLog` (maks 50) → `refreshNow()`. Tanpa akun / sedang busy → tidak melakukan apa pun. */
  run(what: string, build: BuildCall, k: PoolKey): Promise<void>;
}
