// test/chain/provider.test.tsx — ChainProvider di atas data layer yang di-mock (tidak pernah ada jaringan): loop refresh §5 dengan fake timers,
// stale/backoff dengan data lama dipertahankan, cadence event (seed → refresh 0 → tiap ke-4), parity/gas gagal terisolasi, wallet events, connect, run.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_ID, DEPLOYED_AT_BLOCK, POOLS } from '@chain/deployment';
import { readSnapshot } from '@chain/chain/snapshot';
import { readParity } from '@chain/chain/parity';
import { readGas } from '@chain/chain/gas';
import { loadSeed, readEvents } from '@chain/chain/events';
import { TxFailed, connect, ensureChain, hasWallet, onWalletEvents, write } from '@chain/chain/wallet';
import { BASE_MS, STALE_MS } from '@chain/ui/poll';
import { ChainProvider, EVENTS_EVERY, MAX_LOG, useChain } from '@/chain/provider';
import type { ChainState } from '@/chain/types';
import { BLOCK, USER, liveGas, liveParity, liveSnapshot } from '../fixtures/snapshot';
import { liveEvents, liveSeed } from '../fixtures/events';

vi.mock('@chain/chain/client', () => ({ client: { fake: 'public-client' }, chain: { id: 421614 } }));
vi.mock('@chain/chain/snapshot', async (orig) => ({ ...(await orig<typeof import('@chain/chain/snapshot')>()), readSnapshot: vi.fn() }));
vi.mock('@chain/chain/parity', () => ({ readParity: vi.fn() }));
vi.mock('@chain/chain/gas', () => ({ readGas: vi.fn() }));
vi.mock('@chain/chain/events', async (orig) => ({ ...(await orig<typeof import('@chain/chain/events')>()), readEvents: vi.fn(), loadSeed: vi.fn() }));
vi.mock('@chain/chain/wallet', async (orig) => ({
  ...(await orig<typeof import('@chain/chain/wallet')>()),
  connect: vi.fn(), ensureChain: vi.fn(), write: vi.fn(), executedBuy: vi.fn(), executedClose: vi.fn(), hasWallet: vi.fn(() => true), onWalletEvents: vi.fn(),
}));

const fakeClient = { fake: 'injected' } as never;
const probe: { current: ChainState | null } = { current: null };
function Probe() { probe.current = useChain(); return null; }
const mount = () => render(<ChainProvider client={fakeClient} pollMs={BASE_MS}><Probe /></ChainProvider>);
/** Memajukan jam palsu sambil membiarkan rantai promise (loadSeed → poll → readSnapshot → parity/gas/events) selesai. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const state = () => probe.current!;
const walletHandlers = () => vi.mocked(onWalletEvents).mock.calls[0]![0];
/** Promise yang diselesaikan dari luar — untuk mensimulasikan RPC/wallet yang masih berjalan. */
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(readSnapshot).mockReset().mockImplementation(async () => liveSnapshot());
  vi.mocked(readParity).mockReset().mockImplementation(async (_c, s) => liveParity(s));
  vi.mocked(readGas).mockReset().mockImplementation(async (_c, s) => liveGas(s));
  vi.mocked(readEvents).mockReset().mockImplementation(async () => liveEvents());
  vi.mocked(loadSeed).mockReset().mockResolvedValue(null);
  vi.mocked(hasWallet).mockReset().mockReturnValue(true);
  vi.mocked(onWalletEvents).mockReset();
  vi.mocked(connect).mockReset(); vi.mocked(ensureChain).mockReset().mockResolvedValue(undefined); vi.mocked(write).mockReset();
  probe.current = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ChainProvider — refresh loop (brief §5)', () => {
  it('(a) the first refresh fills snapshot, meta.lastOkMs, parity and gas; readSnapshot gets the injected client and no account', async () => {
    mount();
    expect(state().snapshot).toBeNull();
    expect(state().meta).toMatchObject({ lastOkMs: null, error: null, stale: false, refreshes: 0 });
    await advance(0);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readSnapshot).mock.calls[0]).toEqual([fakeClient, undefined]);
    expect(state().snapshot!.blockNumber).toBe(BLOCK);
    expect(state().meta).toMatchObject({ lastOkMs: Date.now(), error: null, stale: false, refreshes: 1 });
    expect(state().parity).toHaveLength(liveSnapshot().series.length);
    expect(state().gas).toEqual(liveGas(liveSnapshot()));
    expect(state().hasWallet).toBe(true);
    // Poll berikutnya setelah BASE_MS (15 s), bukan sebelumnya.
    await advance(BASE_MS - 1);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(2);
    expect(state().meta.refreshes).toBe(2);
  });

  it('(b) an RPC failure after a success keeps the last snapshot, sets meta.error, turns stale after 60 s, backs off 30/60 s and recovers', async () => {
    mount();
    await advance(0);
    const first = state().snapshot!;
    const okAt = state().meta.lastOkMs!;
    vi.mocked(readSnapshot).mockRejectedValue(new Error('HTTP request failed.'));
    await advance(BASE_MS);                                   // t = 15 s: gagal #1
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(2);
    expect(state().snapshot).toBe(first);                     // data lama tetap di layar
    expect(state().meta).toMatchObject({ error: 'HTTP request failed.', lastOkMs: okAt, stale: false, refreshes: 1 });
    await advance(44_000);                                    // t = 59 s: belum stale (umur ≤ 60 s)
    expect(state().meta.stale).toBe(false);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(3); // backoff 30 s → percobaan #3 pada t = 45 s
    await advance(2_000);                                     // t = 61 s: stale
    expect(state().meta.stale).toBe(true);
    expect(state().snapshot).toBe(first);
    expect(Date.now() - state().meta.lastOkMs!).toBeGreaterThan(STALE_MS);
    // Backoff 60 s setelah kegagalan kedua: percobaan #4 pada t = 105 s — RPC pulih → error hilang, stale hilang, poll berlanjut sendiri.
    vi.mocked(readSnapshot).mockImplementation(async () => ({ ...liveSnapshot(), blockNumber: BLOCK + 7n }));
    await advance(43_000);                                    // t = 104 s
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(3);
    await advance(1_000);                                     // t = 105 s
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(4);
    expect(state().meta).toMatchObject({ error: null, stale: false, refreshes: 2 });
    expect(state().snapshot!.blockNumber).toBe(BLOCK + 7n);
  });

  it('(b′) a failure on the very first load leaves snapshot null with the error (retry + explanation state)', async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new Error('HTTP request failed.'));
    mount();
    await advance(0);
    expect(state().snapshot).toBeNull();
    expect(state().meta).toMatchObject({ error: 'HTTP request failed.', lastOkMs: null, stale: false });
    expect(vi.mocked(readEvents)).not.toHaveBeenCalled();
  });

  it('(c) events: seed first, then a delta on refresh 0 and every 4th refresh only, from lastEventsBlock + 1 to the snapshot block', async () => {
    let n = 0;
    vi.mocked(readSnapshot).mockImplementation(async () => ({ ...liveSnapshot(), blockNumber: BLOCK + BigInt(n++) }));
    mount();
    expect(state().eventsState).toBe('seed');
    await advance(0);                                          // refresh 0
    expect(vi.mocked(readEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readEvents).mock.calls[0]).toEqual([fakeClient, BLOCK, DEPLOYED_AT_BLOCK]);   // tanpa seed: pindaian dari blok deploy
    expect(state().eventsState).toBe('live');
    expect(state().events.trades).toHaveLength(liveEvents().trades.length);
    expect(state().events.observed).toHaveLength(liveEvents().observed.length);
    for (let r = 1; r < EVENTS_EVERY; r++) { await advance(BASE_MS); expect(vi.mocked(readEvents), `refresh ${r}`).toHaveBeenCalledTimes(1); }
    await advance(BASE_MS);                                    // refresh 4
    expect(vi.mocked(readEvents)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readEvents).mock.calls[1]).toEqual([fakeClient, BLOCK + 4n, BLOCK + 1n]);      // delta: lastEventsBlock + 1 … blok snapshot
    expect(state().meta.refreshes).toBe(5);
    // Delta yang sama digabung tanpa duplikat (dedupe tx+logIndex).
    expect(state().events.trades).toHaveLength(liveEvents().trades.length);
  });

  it('(c′) with a build-time seed the feed is filled before any RPC and the first scan starts at seed.lastBlock + 1', async () => {
    const seed = liveSeed();
    vi.mocked(loadSeed).mockResolvedValue(seed);
    vi.mocked(readEvents).mockResolvedValue({ trades: [], observed: [] });
    const pending = deferred<ReturnType<typeof liveSnapshot>>();
    vi.mocked(readSnapshot).mockReturnValueOnce(pending.promise);   // snapshot pertama ditahan: hanya seed yang bisa masuk
    mount();
    await advance(0);
    expect(state().snapshot).toBeNull();
    expect(state().events.trades).toHaveLength(seed.trades.length);
    expect(state().eventsState).toBe('seed');
    await act(async () => { pending.resolve(liveSnapshot()); await vi.advanceTimersByTimeAsync(0); });
    expect(vi.mocked(readEvents).mock.calls[0]).toEqual([fakeClient, BLOCK, seed.lastBlock + 1n]);
    expect(state().eventsState).toBe('live');
    expect(state().events.observed).toHaveLength(seed.observed.length);
  });

  it('(c″) a failed scan keeps the old feed, reports eventsState error and retries on the next refresh while nothing succeeded yet', async () => {
    vi.mocked(readEvents).mockRejectedValueOnce(new Error('429')).mockResolvedValue(liveEvents());
    mount();
    await advance(0);
    expect(state().eventsState).toBe('error');
    expect(state().events.trades).toEqual([]);
    await advance(BASE_MS);                                    // refresh 1: lastEventsBlock masih null → dicoba lagi
    expect(vi.mocked(readEvents)).toHaveBeenCalledTimes(2);
    expect(state().eventsState).toBe('live');
    expect(state().events.trades).toHaveLength(liveEvents().trades.length);
  });

  it('(d) readParity / readGas failures do not fail the snapshot and only leave their own panel empty', async () => {
    vi.mocked(readParity).mockRejectedValue(new Error('multicall failed'));
    vi.mocked(readGas).mockRejectedValue(new Error('estimateGas failed'));
    mount();
    await advance(0);
    expect(state().snapshot).not.toBeNull();
    expect(state().meta.error).toBeNull();
    expect(state().parity).toEqual([]);
    expect(state().gas).toBeNull();
    expect(state().eventsState).toBe('live');                  // event tetap dibaca setelah parity/gas gagal
  });

  it('refreshNow(): shares a running refresh and re-runs once after it; idle → immediate', async () => {
    const pending = deferred<ReturnType<typeof liveSnapshot>>();
    vi.mocked(readSnapshot).mockReturnValueOnce(pending.promise);
    mount();
    await advance(0);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(1);
    act(() => { state().refreshNow(); state().refreshNow(); });
    await advance(0);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(1);  // masih menunggu yang pertama
    await act(async () => { pending.resolve(liveSnapshot()); await vi.advanceTimersByTimeAsync(0); });
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(2);  // satu refresh susulan (bukan dua)
    act(() => state().refreshNow());
    await advance(0);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(3);
  });

  it('stops polling and ticking on unmount', async () => {
    const view = mount();
    await advance(0);
    view.unmount();
    await advance(10 * BASE_MS);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(1);
  });
});

describe('ChainProvider — wallet', () => {
  it('useChain() throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside <ChainProvider>/);
  });

  it('accountsChanged sets the account and re-reads the snapshot with it; [] disconnects; chainChanged toggles wrongChain and refreshes on return', async () => {
    mount();
    await advance(0);
    expect(vi.mocked(onWalletEvents)).toHaveBeenCalledTimes(1);
    act(() => walletHandlers().accounts([USER]));
    expect(state().account).toBe(USER);
    await advance(0);
    expect(vi.mocked(readSnapshot).mock.calls.at(-1)).toEqual([fakeClient, USER]);
    act(() => walletHandlers().chain(1));
    expect(state().wrongChain).toBe(true);
    const calls = vi.mocked(readSnapshot).mock.calls.length;
    act(() => walletHandlers().chain(CHAIN_ID));
    await advance(0);
    expect(state().wrongChain).toBe(false);
    expect(vi.mocked(readSnapshot)).toHaveBeenCalledTimes(calls + 1);
    act(() => walletHandlers().accounts([]));
    expect(state().account).toBeNull();
    await advance(0);
    expect(vi.mocked(readSnapshot).mock.calls.at(-1)).toEqual([fakeClient, undefined]);
  });

  it('without an injected wallet: hasWallet false and no EIP-1193 listener', async () => {
    vi.mocked(hasWallet).mockReturnValue(false);
    mount();
    await advance(0);
    expect(state().hasWallet).toBe(false);
    expect(vi.mocked(onWalletEvents)).not.toHaveBeenCalled();
  });

  it('connect(): requestAddresses + ensureChain → account + refresh; rejection is logged as ✗ connect; wrong chain → ensureChain only', async () => {
    vi.mocked(connect).mockResolvedValue(USER);
    mount();
    await advance(0);
    await act(() => state().connect());
    expect(vi.mocked(connect)).toHaveBeenCalledTimes(1);
    expect(state().account).toBe(USER);
    expect(state().busy).toBe(false);
    await advance(0);
    expect(vi.mocked(readSnapshot).mock.calls.at(-1)).toEqual([fakeClient, USER]);
    // Salah jaringan dengan akun sudah ada → hanya pindah chain (4902/4001 ditangani ensureChain), tanpa requestAddresses lagi.
    act(() => walletHandlers().chain(1));
    await act(() => state().connect());
    expect(vi.mocked(ensureChain)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(connect)).toHaveBeenCalledTimes(1);
    expect(state().wrongChain).toBe(false);
    // Ditolak pengguna → baris log, akun tidak berubah.
    vi.mocked(ensureChain).mockRejectedValueOnce(new Error('Switch to Arbitrum Sepolia to continue'));
    act(() => walletHandlers().chain(1));
    await act(() => state().connect());
    expect(state().txLog[0]).toMatchObject({ ok: false, what: 'connect', tail: 'Switch to Arbitrum Sepolia to continue' });
    expect(state().account).toBe(USER);
  });
});

describe('ChainProvider — run()', () => {
  const call = { address: POOLS.A.pool, abi: [], functionName: 'claim', args: [1n, 2n] };
  const connectUser = async () => { mount(); await advance(0); act(() => walletHandlers().accounts([USER])); await advance(0); };

  it('logs a pending entry, then ✓ with the hash; captures the account at call time; refreshes after the action', async () => {
    await connectUser();
    const pending = deferred<`0x${string}`>();
    vi.mocked(write).mockReturnValueOnce(pending.promise);
    const before = vi.mocked(readSnapshot).mock.calls.length;
    let done: Promise<void>;
    act(() => { done = state().run('claim 1.00 C 2800 #0 (25 Sep) on A', () => call, 'A'); });
    expect(state().busy).toBe(true);
    expect(state().txLog[0]).toMatchObject({ ok: null, what: 'claim 1.00 C 2800 #0 (25 Sep) on A', tail: '' });
    await advance(0);                                          // `await build(k, acct)` → write pada microtask berikutnya
    expect(vi.mocked(write)).toHaveBeenCalledWith(call, USER);
    await act(async () => { pending.resolve('0xabc'); await done; });
    expect(state().busy).toBe(false);
    expect(state().txLog).toHaveLength(1);
    expect(state().txLog[0]).toMatchObject({ ok: true, hash: '0xabc', tail: '' });
    await advance(0);
    expect(vi.mocked(readSnapshot).mock.calls.length).toBe(before + 1);
    expect(vi.mocked(readSnapshot).mock.calls.at(-1)).toEqual([fakeClient, USER]);
  });

  it('rejects a second action while busy (one action at a time)', async () => {
    await connectUser();
    const pending = deferred<`0x${string}`>();
    vi.mocked(write).mockReturnValueOnce(pending.promise);
    act(() => { void state().run('first', () => call, 'A'); });
    let second: Promise<void>;
    act(() => { second = state().run('second', () => call, 'B'); });
    await act(() => second);
    expect(vi.mocked(write)).toHaveBeenCalledTimes(1);
    expect(state().txLog.map((e) => e.what)).toEqual(['first']);
    await act(async () => { pending.resolve('0xdef'); await vi.advanceTimersByTimeAsync(0); });
    expect(state().busy).toBe(false);
    // Setelah selesai aksi berikutnya diterima.
    vi.mocked(write).mockResolvedValueOnce('0x123');
    await act(() => state().run('third', () => call, 'B'));
    expect(vi.mocked(write)).toHaveBeenCalledTimes(2);
    expect(state().txLog.map((e) => e.what)).toEqual(['third', 'first']);
  });

  it('a revert is decoded into the log without a hash; TxFailed keeps the hash; the Pool C cap hint is appended on paxos pools', async () => {
    await connectUser();
    vi.mocked(write).mockRejectedValueOnce(new Error('User rejected the request.'));
    await act(() => state().run('approve USDG (mock) for A', () => call, 'A'));
    expect(state().txLog[0]).toMatchObject({ ok: false, what: 'approve USDG (mock) for A', tail: 'User rejected the request.' });
    expect(state().txLog[0]!.hash).toBeUndefined();
    vi.mocked(write).mockRejectedValueOnce(new TxFailed('Transaction reverted on-chain (status 0)', '0xdead'));
    await act(() => state().run('buy 0.10 C 2800 #0 (25 Sep) on B', () => call, 'B'));
    expect(state().txLog[0]).toMatchObject({ ok: false, tail: 'Transaction reverted on-chain (status 0)', hash: '0xdead' });
    const paxos = (Object.keys(POOLS) as (keyof typeof POOLS)[]).find((k) => POOLS[k].faucet === 'paxos');
    if (paxos) {
      vi.mocked(write).mockRejectedValueOnce(new Error('Vega cap reached (5 % of the capital reference).'));
      await act(() => state().run(`buy 1.00 C 2600 #1 (2 Oct) on ${paxos}`, () => call, paxos));
      expect(state().txLog[0]!.tail).toBe('Vega cap reached (5 % of the capital reference). Pool C is a faucet-scale pool — try 0.01 units or use A/B.');
    }
    // Aksi setelah build() gagal (mis. simulasi executedBuy revert) juga dicatat dan busy dilepas.
    await act(() => state().run('close', () => { throw new Error('Reverted: SeriesExpired'); }, 'A'));
    expect(state().txLog[0]).toMatchObject({ ok: false, what: 'close', tail: 'Reverted: SeriesExpired' });
    expect(state().busy).toBe(false);
  });

  it('does nothing without an account; the log is capped at MAX_LOG newest-first', async () => {
    mount();
    await advance(0);
    await act(() => state().run('faucet', () => call, 'A'));
    expect(vi.mocked(write)).not.toHaveBeenCalled();
    expect(state().txLog).toEqual([]);
    act(() => walletHandlers().accounts([USER]));
    vi.mocked(write).mockResolvedValue('0x1');
    for (let i = 0; i < MAX_LOG + 5; i++) await act(() => state().run(`tx ${i}`, () => call, 'A'));
    expect(state().txLog).toHaveLength(MAX_LOG);
    expect(state().txLog[0]!.what).toBe(`tx ${MAX_LOG + 4}`);
    expect(state().txLog.at(-1)!.what).toBe('tx 5');
  });
});
