// provider.tsx — port `web/src/main.ts` (loop refresh) + bagian wallet `web/src/panels/trade.ts` ke React.
// Satu ChainProvider memegang { snapshot, meta, parity, gas, events, account, wrongChain, busy, txLog }; halaman hanya membaca lewat useChain()/selector.
// Setiap aturan brief §5 dijelaskan di tempatnya; tidak ada logika chain baru — semua pembacaan/penulisan memakai @chain (web/src).
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Address } from 'viem';
import { client as defaultClient, type Client } from '@chain/chain/client';
import { readSnapshot, type Snapshot } from '@chain/chain/snapshot';
import { readParity, type ParityRow } from '@chain/chain/parity';
import { readGas, type GasEstimate } from '@chain/chain/gas';
import { loadSeed, mergeEvents, readEvents, type EventSeed, type Events } from '@chain/chain/events';
import { TxFailed, connect as walletConnect, decodeRevert, ensureChain, hasWallet, onWalletEvents, write } from '@chain/chain/wallet';
import { isStale, pollBaseMs, startPolling } from '@chain/ui/poll';
import { CHAIN_ID, DEPLOYED_AT_BLOCK, POOLS, type PoolKey } from '@chain/deployment';
import type { BuildCall, ChainState, EventsState, Meta, SeedMeta, TxEntry } from './types';

/** Event dibaca pada snapshot pertama yang berhasil, lalu tiap EVENTS_EVERY refresh (≈ 60 s pada interval 15 s) — sama dengan main.ts. */
export const EVENTS_EVERY = 4;
/** Baris log transaksi maksimum (yang terbaru di depan) — sama dengan panel Trade klasik. */
export const MAX_LOG = 50;

interface State {
  snapshot: Snapshot | null; meta: Meta; parity: ParityRow[]; gas: GasEstimate | null; events: Events; eventsState: EventsState; seed: SeedMeta | null;
  account: Address | null; wrongChain: boolean; busy: boolean; txLog: TxEntry[];
}
type Action =
  | { type: 'snapshot'; snapshot: Snapshot; atMs: number; refreshes: number }
  | { type: 'error'; message: string; atMs: number }
  | { type: 'parity'; rows: ParityRow[] }
  | { type: 'gas'; gas: GasEstimate | null }
  | { type: 'seed'; seed: EventSeed }
  | { type: 'events'; next: Events }
  | { type: 'eventsState'; state: EventsState }
  | { type: 'account'; account: Address | null }
  | { type: 'wrongChain'; wrongChain: boolean }
  | { type: 'busy'; busy: boolean }
  | { type: 'tx'; entry: TxEntry };

const initial = (nowMs: number): State => ({
  snapshot: null, meta: { nowMs, lastOkMs: null, error: null, stale: false, refreshes: 0 }, parity: [], gas: null,
  events: { trades: [], observed: [] }, eventsState: 'seed', seed: null, account: null, wrongChain: false, busy: false, txLog: [],
});
/** `stale` dievaluasi SAAT refresh gagal (umur data terakhir > STALE_MS pada `nowMs` kegagalan itu) — tidak berdetak; badge/banner UI
 *  menghitung ulang dari `isStale(meta.lastOkMs, useNow())` (ClockProvider). Sebelum snapshot pertama UI memakai `snapshot === null` (loading / gagal). */
const withNow = (meta: Meta, nowMs: number): Meta => ({ ...meta, nowMs, stale: meta.lastOkMs !== null && isStale(meta.lastOkMs, nowMs) });

function reduce(s: State, a: Action): State {
  switch (a.type) {
    // Snapshot sukses: data baru, error dihapus, lastOk = sekarang. Parity/gas dari snapshot sebelumnya tetap tampil sampai pembacaannya menyusul.
    case 'snapshot': return { ...s, snapshot: a.snapshot, meta: { ...s.meta, nowMs: a.atMs, lastOkMs: a.atMs, error: null, stale: false, refreshes: a.refreshes } };
    // RPC gagal: pesan disimpan, snapshot LAMA tetap di layar (brief §5: hiccup RPC publik tidak boleh mengosongkan halaman); `stale` mengikuti umur data.
    case 'error': return { ...s, meta: withNow({ ...s.meta, error: a.message }, a.atMs) };
    case 'parity': return { ...s, parity: a.rows };
    case 'gas': return { ...s, gas: a.gas };
    // Seed hasil build DIGABUNG (bukan menimpa): bila pindaian rantai pertama sempat selesai lebih dulu (seed = fetch async), delta yang lebih baru
    // tidak boleh hilang; dedupe (tx, logIndex) memastikan event yang ada di keduanya muncul sekali. Metadata seed disimpan untuk kaki halaman Activity.
    case 'seed': return { ...s, events: mergeEvents(s.events, { trades: a.seed.trades, observed: a.seed.observed }), seed: { generatedAt: a.seed.generatedAt, lastBlock: a.seed.lastBlock } };
    // Delta inkremental digabung dengan dedupe (tx, logIndex) — pembacaan terbaru menang; trades terbaru dulu, observed urut rantai (mergeEvents).
    case 'events': return { ...s, events: mergeEvents(s.events, a.next), eventsState: 'live' };
    case 'eventsState': return { ...s, eventsState: a.state };
    case 'account': return { ...s, account: a.account };
    case 'wrongChain': return { ...s, wrongChain: a.wrongChain };
    case 'busy': return { ...s, busy: a.busy };
    // Upsert per id (entri pending diganti hasil akhirnya), yang terbaru di depan, dipotong MAX_LOG.
    case 'tx': {
      const exists = s.txLog.some((e) => e.id === a.entry.id);
      return { ...s, txLog: exists ? s.txLog.map((e) => (e.id === a.entry.id ? a.entry : e)) : [a.entry, ...s.txLog].slice(0, MAX_LOG) };
    }
  }
}

export const ChainContext = createContext<ChainState | null>(null);

export interface ChainProviderProps {
  /** Client viem; default = client publik `@chain/chain/client`. Di-inject di test. */
  client?: Client;
  /** Interval poll dasar (ms); default `pollBaseMs()` = 15 s atau `?poll=` (≥ 2 s). */
  pollMs?: number;
  children: ReactNode;
}

export function ChainProvider({ client = defaultClient, pollMs, children }: ChainProviderProps) {
  const [state, dispatch] = useReducer(reduce, Date.now(), initial);
  // Nilai yang dibaca oleh loop async (bukan render): akun untuk readSnapshot, hitung refresh, blok event terakhir, promise refresh bersama, gerbang busy.
  const accountRef = useRef<Address | null>(null);
  const wrongChainRef = useRef(false);
  const refreshesRef = useRef(0);
  const lastEventsBlockRef = useRef<bigint | null>(null);
  const runningRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  const txSeqRef = useRef(0);
  const walletPresent = useMemo(() => hasWallet(), []);

  const api = useMemo(() => {
    const onError = (e: unknown) => dispatch({ type: 'error', message: e instanceof Error ? e.message : String(e), atMs: Date.now() });
    async function refresh() {
      // Satu snapshot per poll, semua pembacaan dipaku ke blok yang sama (readSnapshot = 3 multicall dengan blockNumber); akun dibaca dari ref saat mulai.
      const s = await readSnapshot(client, accountRef.current ?? undefined);
      dispatch({ type: 'snapshot', snapshot: s, atMs: Date.now(), refreshes: refreshesRef.current + 1 });
      // Paritas K5 dan estimasi gas menyusul SETELAH snapshot, masing-masing try/catch — kegagalannya hanya mengenai panelnya sendiri (brief §5).
      try { dispatch({ type: 'parity', rows: await readParity(client, s) }); } catch (e) { console.warn('parity:', e); }
      try { dispatch({ type: 'gas', gas: await readGas(client, s) }); } catch (e) { console.warn('gas:', e); }
      // Event: pada snapshot sukses ke-0 (atau selama belum pernah berhasil) dan tiap refresh ke-EVENTS_EVERY; hanya lastEventsBlock+1 … blok snapshot.
      const n = refreshesRef.current++;
      if (lastEventsBlockRef.current === null || n % EVENTS_EVERY === 0) {
        dispatch({ type: 'eventsState', state: 'scanning' });
        try {
          const from = lastEventsBlockRef.current === null ? DEPLOYED_AT_BLOCK : lastEventsBlockRef.current + 1n;
          const next = await readEvents(client, s.blockNumber, from);
          lastEventsBlockRef.current = s.blockNumber;
          dispatch({ type: 'events', next });
        } catch (e) { console.warn('events:', e); dispatch({ type: 'eventsState', state: 'error' }); }
      }
    }
    // Satu refresh pada satu waktu: poll dan refreshNow berbagi promise yang sedang berjalan (main.ts `running`).
    const refreshOnce = () => runningRef.current ?? (runningRef.current = refresh().finally(() => { runningRef.current = null; }));
    const refreshNow = () => { (runningRef.current ? runningRef.current.then(refreshOnce, refreshOnce) : refreshOnce()).catch(onError); };
    const setAccount = (a: Address | null) => {
      if (a === accountRef.current) return;
      accountRef.current = a;
      dispatch({ type: 'account', account: a });
      // Snapshot dibaca ulang dengan akun baru segera (saldo/allowance/posisi), bukan menunggu poll berikutnya.
      refreshNow();
    };
    const setBusy = (b: boolean) => { busyRef.current = b; dispatch({ type: 'busy', busy: b }); };
    const log = (entry: Omit<TxEntry, 'id' | 'atMs'> & { id?: number }) => {
      const id = entry.id ?? ++txSeqRef.current;
      dispatch({ type: 'tx', entry: { ...entry, id, atMs: Date.now() } });
      return id;
    };
    async function connect() {
      if (busyRef.current) return;
      setBusy(true);
      try {
        // Sudah connect tapi salah jaringan → cukup pindah chain (4902 → tambah dulu, 4001 → pesan); selain itu requestAddresses + ensureChain.
        const cur = accountRef.current;
        const a = wrongChainRef.current && cur ? (await ensureChain(), cur) : await walletConnect();
        wrongChainRef.current = false; dispatch({ type: 'wrongChain', wrongChain: false });
        if (a !== cur) setAccount(a); else refreshNow();
      } catch (e) { log({ ok: false, what: 'connect', tail: decodeRevert(e) }); }
      finally { setBusy(false); }
    }
    async function run(what: string, build: BuildCall, k: PoolKey) {
      // Akun ditangkap SEKARANG (sinkron, saat klik) — bukan dibaca ulang setelah await; satu aksi pada satu waktu (gerbang busy).
      const acct = accountRef.current;
      if (busyRef.current || !acct) return;
      setBusy(true);
      const id = log({ ok: null, what, tail: '' });
      try {
        // build boleh membaca kuotasi/simulasi segar (batas dari JALUR EKSEKUSI, brief §6.2); write = simulate → gas ×1,5 → wallet → receipt.
        const hash = await write(await build(k, acct), acct);
        log({ id, ok: true, what, tail: '', hash });
      } catch (e) {
        let msg = decodeRevert(e);
        // Pool ber-aset faucet (C, ≈ 90 USDG): cap cadangan/vega tercapai oleh ukuran kecil — arahkan ke 0,01 unit atau A/B (sama dengan panel klasik).
        if (POOLS[k].faucet === 'paxos' && /^(Reserve cap|Vega cap)/.test(msg)) msg += ' Pool C is a faucet-scale pool — try 0.01 units or use A/B.';
        // Tx terkirim tapi gagal/timeout/receipt gagal dibaca → TxFailed membawa hash agar log tetap punya tautan explorer.
        log({ id, ok: false, what, tail: msg, hash: e instanceof TxFailed ? e.hash : undefined });
      } finally {
        setBusy(false);
        // Setelah SETIAP aksi (sukses atau gagal) snapshot dengan akun dibaca ulang segera.
        refreshNow();
      }
    }
    return { refreshOnce, refreshNow, onError, setAccount, connect, run };
  }, [client]);

  // Mount: seed hasil build dulu (umpan tampil seketika, pindaian pertama hanya dari lastBlock+1), baru poll dimulai — urutan yang sama dengan main.ts.
  // `lastEventsBlockRef` hanya diisi dari seed bila masih null: bila pindaian rantai (mis. lewat refreshNow) sudah menetapkan blok yang lebih tinggi,
  // seed tidak boleh menurunkannya (pindaian ulang rentang yang sudah dibaca).
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const seed = await loadSeed();
        if (seed && !cancelled) { if (lastEventsBlockRef.current === null) lastEventsBlockRef.current = seed.lastBlock; dispatch({ type: 'seed', seed }); }
      } catch (e) { console.warn('seed:', e); }
      // Poll 15 s (`?poll=` ≥ 2 s), backoff eksponensial 30 s / 60 s saat gagal, berhenti saat unmount.
      if (!cancelled) stop = startPolling(api.refreshOnce, api.onError, pollMs ?? pollBaseMs());
    })();
    return () => { cancelled = true; stop?.(); };
  }, [api, pollMs]);

  // Tidak ada detak 1 s di context ini: umur data / badge stale / countdown dibaca UI dari `useNow()` (ClockProvider, context terpisah) —
  // setiap konsumen useChain() hanya dirender ulang oleh perubahan data (snapshot/error/event/wallet), bukan tiap detik.

  // Pendengar EIP-1193: accountsChanged([]) = disconnect; chainChanged → wrongChain (kembali ke 421614 → refresh dengan akun).
  // Cleanup melepas pendengar (removeListener) — StrictMode dev memasang/melepas dua kali tanpa menumpuk handler.
  useEffect(() => {
    if (!walletPresent) return;
    return onWalletEvents({
      accounts: (a) => api.setAccount(a[0] ?? null),
      chain: (id) => {
        const wrong = id !== CHAIN_ID;
        wrongChainRef.current = wrong; dispatch({ type: 'wrongChain', wrongChain: wrong });
        if (!wrong) api.refreshNow();
      },
    });
  }, [api, walletPresent]);

  const value = useMemo<ChainState>(() => ({
    client, ...state, hasWallet: walletPresent, refreshNow: api.refreshNow, connect: api.connect, run: api.run,
  }), [client, state, walletPresent, api]);
  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

/** State chain bersama; melempar bila dipakai di luar <ChainProvider> (kesalahan wiring terdeteksi saat render, bukan sebagai `—` diam-diam). */
export function useChain(): ChainState {
  const v = useContext(ChainContext);
  if (!v) throw new Error('useChain() must be used inside <ChainProvider>');
  return v;
}
