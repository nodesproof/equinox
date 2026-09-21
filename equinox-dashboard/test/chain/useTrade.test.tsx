// test/chain/useTrade.test.tsx — aksi wallet lewat ChainProvider nyata dengan @chain/chain/wallet & client yang di-mock: buy memakai executedBuy → buyCall(k, id, size,
// premExec, scaleFee(...)), close memakai minProceeds(executedClose), approve pada POOLS[k].asset, faucet hanya untuk faucet === 'mint', run menolak aksi kedua saat busy;
// pratinjau: debounce 250 ms + penjaga urutan, simulasi gagal tidak menutupi kuotasi indikatif, guard ukuran/posisi sebelum RPC.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SERIES, POOLS, POOL_KEYS, USDG, WAD, type PoolKey } from '@chain/deployment';
import { readSnapshot } from '@chain/chain/snapshot';
import { readParity } from '@chain/chain/parity';
import { readGas } from '@chain/chain/gas';
import { loadSeed, readEvents } from '@chain/chain/events';
import { executedBuy, executedClose, hasWallet, onWalletEvents, write } from '@chain/chain/wallet';
import {
  ALLOWANCE_MIN, FAUCET_AMOUNT, MAX_UINT, MIN_SIZE, REVERT_TEXT, approveCall, buyCall, claimCall, closeCall, depositCall, faucetCall, maxPremium, minProceeds, redeemCall,
  scaleFee, seriesLabel,
} from '@chain/chain/trade';
import { ChainProvider, useChain } from '@/chain/provider';
import type { ChainState } from '@/chain/types';
import { DEBOUNCE_MS, parseAmount, useTrade, type TradeApi } from '@/chain/useTrade';
import { USER, demoPositions, liveSnapshot, withSettled, withUser } from '../fixtures/snapshot';

vi.mock('@chain/chain/client', () => ({ client: { fake: 'public-client' }, chain: { id: 421614 } }));
vi.mock('@chain/chain/snapshot', async (orig) => ({ ...(await orig<typeof import('@chain/chain/snapshot')>()), readSnapshot: vi.fn() }));
vi.mock('@chain/chain/parity', () => ({ readParity: vi.fn() }));
vi.mock('@chain/chain/gas', () => ({ readGas: vi.fn() }));
vi.mock('@chain/chain/events', async (orig) => ({ ...(await orig<typeof import('@chain/chain/events')>()), readEvents: vi.fn(), loadSeed: vi.fn() }));
vi.mock('@chain/chain/wallet', async (orig) => ({
  ...(await orig<typeof import('@chain/chain/wallet')>()),
  connect: vi.fn(), ensureChain: vi.fn(), write: vi.fn(), executedBuy: vi.fn(), executedClose: vi.fn(), hasWallet: vi.fn(() => true), onWalletEvents: vi.fn(),
}));

/** Kuotasi view Appendix/web test: premi 268.181826 + fee 8.045455; eksekusi 270.000000 (post-poke). */
const Q = { premiumAssets: 268_181_826n, feeAssets: 8_045_455n, sigma: 661_300_000_000_000_000n, delta: 550_000_000_000_000_000n, vegaTotal: 3n * WAD, spotWad: 2_579n * WAD };
const PREM_EXEC = 270_000_000n;
const readContract = vi.fn();
const fakeClient = { readContract } as never;
const probe: { current: TradeApi | null; chain: ChainState | null } = { current: null, chain: null };
function Probe() { probe.current = useTrade(); probe.chain = useChain(); return null; }
const api = () => probe.current!;
const chain = () => probe.chain!;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const idx = (boardId: number, strike: number, isCall: boolean) => ALL_SERIES.findIndex((s) => s.boardId === boardId && s.strike === strike && s.isCall === isCall);
const C2800 = idx(0, 2800, true), P2400 = idx(0, 2400, false), C2600_1 = idx(1, 2600, true);
const SIZE = 10n ** 17n;                                   // 0.1 unit
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
/** Mount dengan snapshot ber-akun USER (posisi demo) dan akun terhubung lewat accountsChanged. */
async function mountConnected(snapshot = withUser(liveSnapshot())) {
  vi.mocked(readSnapshot).mockImplementation(async () => snapshot);
  render(<ChainProvider client={fakeClient} pollMs={15_000}><Probe /></ChainProvider>);
  await advance(0);
  act(() => vi.mocked(onWalletEvents).mock.calls[0]![0].accounts([USER]));
  await advance(0);
}
const lastWrite = () => vi.mocked(write).mock.calls.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  readContract.mockReset().mockImplementation(async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
    if (functionName === 'quoteBuy') return Q;
    if (functionName === 'quoteClose') return [993_178n, 599_000_000_000_000_000n, 2_579n * WAD] as const;
    if (functionName === 'previewDeposit') return args[0]! - 1n;      // 1 wei share kurang dari aset (NAV/share > 1)
    if (functionName === 'previewRedeem') return args[0]! + 1n;
    throw new Error(`unexpected readContract ${functionName}`);
  });
  vi.mocked(readParity).mockReset().mockResolvedValue([]);
  vi.mocked(readGas).mockReset().mockResolvedValue(null);
  vi.mocked(readEvents).mockReset().mockResolvedValue({ trades: [], observed: [] });
  vi.mocked(loadSeed).mockReset().mockResolvedValue(null);
  vi.mocked(hasWallet).mockReset().mockReturnValue(true);
  vi.mocked(onWalletEvents).mockReset();
  vi.mocked(write).mockReset().mockResolvedValue('0xhash');
  vi.mocked(executedBuy).mockReset().mockResolvedValue(PREM_EXEC);
  vi.mocked(executedClose).mockReset().mockResolvedValue(993_533n);
  probe.current = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('actions → ChainState.run (calldata from @chain/chain/trade builders)', () => {
  it('buy: fresh quoteBuy → executedBuy(k, id, size, acct) → buyCall(k, id, size, premExec, scaleFee(feeQ, premQ, premExec)); cap = maxPremium of the executed path', async () => {
    await mountConnected();
    const ref = ALL_SERIES[C2600_1]!;
    expect(api().actions.buy('B', C2600_1, SIZE)).toBeNull();
    await advance(0);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS.B.pool, functionName: 'quoteBuy', args: [ref.id.B, SIZE] }));
    expect(vi.mocked(executedBuy)).toHaveBeenCalledWith('B', ref.id.B, SIZE, USER);
    const fee = scaleFee(Q.feeAssets, Q.premiumAssets, PREM_EXEC);
    expect(lastWrite()).toEqual([buyCall('B', ref.id.B, SIZE, PREM_EXEC, fee), USER]);
    expect(lastWrite()[0]).toMatchObject({ address: POOLS.B.pool, functionName: 'buy', args: [ref.id.B, SIZE, maxPremium(PREM_EXEC, fee)] });
    expect((lastWrite()[0].args as bigint[])[2]).toBe(280_881_001n);            // (270 + 8.100001) × 1.01, floor — sama dengan web/test/trade.test.ts
    expect(vi.mocked(executedBuy).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(write).mock.invocationCallOrder[0]!);
  });
  it('buy guards run before any RPC: no series/size, size < MIN_SIZE (text = REVERT_TEXT.SizeTooSmall), no account', async () => {
    await mountConnected();
    expect(api().actions.buy('B', null, SIZE)).toBe('pick a series and a size');
    expect(api().actions.buy('B', C2600_1, null)).toBe('pick a series and a size');
    expect(api().actions.buy('B', C2600_1, MIN_SIZE - 1n)).toBe(REVERT_TEXT.SizeTooSmall);
    await advance(0);
    expect(readContract).not.toHaveBeenCalled(); expect(vi.mocked(executedBuy)).not.toHaveBeenCalled(); expect(vi.mocked(write)).not.toHaveBeenCalled();
    act(() => vi.mocked(onWalletEvents).mock.calls[0]![0].accounts([]));
    expect(api().actions.buy('B', C2600_1, SIZE)).toBe('connect a wallet first');
  });
  it('close: minProceeds(executedClose) — never from quoteClose; size above the position is refused before RPC', async () => {
    await mountConnected();
    const ref = ALL_SERIES[C2800]!;
    expect(api().actions.close('A', C2800, 6n * WAD)).toBe('size exceeds your position (5.00 units)');
    expect(api().actions.close('A', C2800, 2n * WAD)).toBeNull();
    await advance(0);
    expect(vi.mocked(executedClose)).toHaveBeenCalledWith('A', ref.id.A, 2n * WAD, USER);
    expect(readContract).not.toHaveBeenCalled();
    expect(lastWrite()).toEqual([closeCall('A', ref.id.A, 2n * WAD, 993_533n), USER]);
    expect((lastWrite()[0].args as bigint[])[2]).toBe(minProceeds(993_533n));
    expect((lastWrite()[0].args as bigint[])[2]).toBe(983_597n);                 // DEMO_LOG Pool C: exec 0.993533 → min 0.983597
  });
  it('approve targets POOLS[k].asset with spender POOLS[k].pool and MAX_UINT (Paxos USDG on C, the mock on A/B)', async () => {
    await mountConnected();
    for (const k of POOL_KEYS) {
      expect(api().actions.approve(k)).toBeNull();
      await advance(0);
      expect(lastWrite()).toEqual([approveCall(k), USER]);
      expect(lastWrite()[0]).toMatchObject({ address: POOLS[k].asset, functionName: 'approve', args: [POOLS[k].pool, MAX_UINT] });
    }
    if (POOL_KEYS.includes('C')) expect(vi.mocked(write).mock.calls.find((c) => (c[0] as { args: readonly unknown[] }).args[0] === POOLS.C.pool)![0].address).not.toBe(USDG);
    expect(vi.mocked(write)).toHaveBeenCalledTimes(POOL_KEYS.length);
  });
  it('faucet mints 100,000 mock USDG only on faucet === "mint" pools; paxos pools get the faucet.paxos.com message and no call', async () => {
    await mountConnected();
    for (const k of POOL_KEYS) {
      const r = api().actions.faucet(k);
      await advance(0);
      if (POOLS[k].faucet === 'mint') { expect(r).toBeNull(); expect(lastWrite()).toEqual([faucetCall(k, USER), USER]); expect(lastWrite()[0]).toMatchObject({ address: POOLS[k].asset, functionName: 'mint', args: [USER, FAUCET_AMOUNT] }); }
      else expect(r).toMatch(/no open mint — get 100 USDG per wallet per day at https:\/\/faucet\.paxos\.com\//);
    }
    expect(vi.mocked(write)).toHaveBeenCalledTimes(POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint').length);
  });
  it('deposit / redeem / claim builders and their guards', async () => {
    const settled = withUser(withSettled(liveSnapshot(), 0, 2900));
    await mountConnected(settled);
    expect(api().actions.deposit('A', null)).toBe('enter a USDG amount');
    expect(api().actions.deposit('A', 100_000_000n)).toBeNull();
    await advance(0);
    expect(lastWrite()).toEqual([depositCall('A', 100_000_000n, USER), USER]);
    expect(api().actions.redeem('B', null)).toBe('enter a share amount');
    expect(api().actions.redeem('B', 9_999_010n)).toBeNull();
    await advance(0);
    expect(lastWrite()).toEqual([redeemCall('B', 9_999_010n, USER), USER]);
    expect(api().actions.claim('A', null)).toBe('nothing to claim');
    expect(api().actions.claim('A', C2600_1)).toBe('nothing to claim');                 // tidak ada posisi di seri itu
    expect(api().actions.claim('A', C2800)).toBeNull();                                  // 5 unit settled @ 100 USDG/unit
    await advance(0);
    expect(lastWrite()).toEqual([claimCall('A', ALL_SERIES[C2800]!.id.A, 5n * WAD), USER]);
    expect(api().claimPreview('A', C2800)).toEqual({ units: 5n * WAD, payoutPerUnit: 100n * WAD, payout: 500_000_000n });
    expect(api().claimPreview('A', P2400)).toEqual({ units: WAD, payoutPerUnit: 0n, payout: 0n });
    expect(api().claimPreview('A', C2600_1)).toBeNull();
  });
  it('run rejects a second action while busy: only the first write happens, the second is dropped silently', async () => {
    await mountConnected();
    const pending = deferred<`0x${string}`>();
    vi.mocked(write).mockReturnValueOnce(pending.promise);
    expect(api().actions.approve('A')).toBeNull();
    await advance(0);
    expect(vi.mocked(write)).toHaveBeenCalledTimes(1);
    expect(api().actions.faucet('A')).toBeNull();                                        // diterima oleh useTrade, ditolak oleh run (busy)
    expect(api().actions.buy('B', C2600_1, SIZE)).toBeNull();
    await advance(0);
    expect(vi.mocked(write)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executedBuy)).not.toHaveBeenCalled();
    await act(async () => { pending.resolve('0x1'); await vi.advanceTimersByTimeAsync(0); });
    expect(api().actions.faucet('A')).toBeNull();
    await advance(0);
    expect(vi.mocked(write)).toHaveBeenCalledTimes(2);
  });
  it('what-strings match the classic panel; the log gets ✓ with the hash and ✗ with the decoded revert; every action ends with a refresh', async () => {
    await mountConnected();
    const ref = ALL_SERIES[C2600_1]!;
    const before = vi.mocked(readSnapshot).mock.calls.length;
    api().actions.buy('B', C2600_1, SIZE);
    await advance(0);
    expect(chain().txLog[0]).toMatchObject({ ok: true, what: `buy 0.10 ${seriesLabel(ref)} on B`, hash: '0xhash' });
    vi.mocked(write).mockRejectedValueOnce(new Error('Reverted: SlippageExceeded'));
    api().actions.close('A', C2800, WAD);
    await advance(0);
    expect(chain().txLog[0]).toMatchObject({ ok: false, what: `close 1.00 ${seriesLabel(ALL_SERIES[C2800]!)} on A`, tail: 'Reverted: SlippageExceeded' });
    api().actions.faucet('A');
    await advance(0);
    expect(chain().txLog.map((e) => e.what)).toEqual(['faucet 100,000 USDG (mock)', `close 1.00 ${seriesLabel(ALL_SERIES[C2800]!)} on A`, `buy 0.10 ${seriesLabel(ref)} on B`]);
    api().actions.approve('A'); await advance(0);
    api().actions.deposit('A', 100_000_000n); await advance(0);
    api().actions.redeem('A', 1_000_000n); await advance(0);
    expect(chain().txLog.slice(0, 3).map((e) => e.what)).toEqual(['redeem 1.000000 shares from A', 'deposit 100.00 USDG into A', 'approve USDG (mock) for A']);
    expect(vi.mocked(write).mock.calls.map((c) => (c[0] as { functionName: string }).functionName)).toEqual(['buy', 'close', 'mint', 'approve', 'deposit', 'redeem']);
    expect(vi.mocked(readSnapshot).mock.calls.length).toBe(before + 6);           // refreshNow() setelah setiap aksi, sukses maupun gagal
    expect(chain().busy).toBe(false);
  });
});

describe('previews (debounce 250 ms + sequence guard, brief §5)', () => {
  it('buy: nothing before 250 ms, one RPC pair after; indicative quote + executed path (feeExec/maxPremium) when an account is connected', async () => {
    await mountConnected();
    act(() => api().preview.buy('B', C2600_1, SIZE));
    expect(api().previews.buy).toMatchObject({ value: null, error: null, loading: true });
    await advance(DEBOUNCE_MS - 1);
    expect(readContract).not.toHaveBeenCalled();
    await advance(1);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executedBuy)).toHaveBeenCalledWith('B', ALL_SERIES[C2600_1]!.id.B, SIZE, USER);
    const fee = scaleFee(Q.feeAssets, Q.premiumAssets, PREM_EXEC);
    expect(api().previews.buy).toEqual({ loading: false, error: null, value: { premium: Q.premiumAssets, fee: Q.feeAssets, sigma: Q.sigma, delta: Q.delta, vega: Q.vegaTotal, exec: PREM_EXEC, feeExec: fee, maxPremium: maxPremium(PREM_EXEC, fee) } });
  });
  it('rapid re-requests collapse into one RPC; a late reply from an older request never overwrites the newer value', async () => {
    await mountConnected();
    const slow = deferred<typeof Q>();
    readContract.mockImplementationOnce(() => slow.promise);
    act(() => api().preview.buy('B', C2600_1, SIZE));
    act(() => api().preview.buy('B', C2600_1, 2n * SIZE));
    act(() => api().preview.buy('B', C2600_1, 3n * SIZE));
    await advance(DEBOUNCE_MS);
    expect(readContract).toHaveBeenCalledTimes(1);                                       // hanya permintaan terakhir (3 × SIZE) yang dikirim
    expect(readContract.mock.calls[0]![0].args).toEqual([ALL_SERIES[C2600_1]!.id.B, 3n * SIZE]);
    // Permintaan baru saat yang lama masih menunggu: balasan baru menang, balasan lama (datang belakangan) dibuang.
    act(() => api().preview.buy('B', C2600_1, SIZE));
    await advance(DEBOUNCE_MS);
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(api().previews.buy.value!.premium).toBe(Q.premiumAssets);
    await act(async () => { slow.resolve({ ...Q, premiumAssets: 1n }); await vi.advanceTimersByTimeAsync(0); });
    expect(api().previews.buy.value!.premium).toBe(Q.premiumAssets);
    expect(api().previews.buy.loading).toBe(false);
  });
  it('a failing simulation does not hide the indicative quote; a failing view quote shows the decoded error; guards need no RPC', async () => {
    await mountConnected();
    vi.mocked(executedBuy).mockRejectedValue(new Error('Reverted: InsufficientAllowance'));
    act(() => api().preview.buy('C' in POOLS ? ('C' as PoolKey) : 'B', C2600_1, SIZE));
    await advance(DEBOUNCE_MS);
    expect(api().previews.buy).toMatchObject({ error: null, value: { premium: Q.premiumAssets, exec: null, feeExec: null, maxPremium: null } });
    readContract.mockRejectedValueOnce(new Error('Reverted: OracleStale'));
    act(() => api().preview.buy('B', C2600_1, SIZE));
    await advance(DEBOUNCE_MS);
    expect(api().previews.buy).toEqual({ value: null, error: 'Reverted: OracleStale', loading: false });
    readContract.mockClear();
    act(() => api().preview.buy('B', C2600_1, MIN_SIZE - 1n));
    await advance(DEBOUNCE_MS);
    expect(api().previews.buy).toEqual({ value: null, error: 'minimum size is 0.01 units', loading: false });
    act(() => api().preview.buy('B', null, SIZE));
    await advance(DEBOUNCE_MS);
    expect(api().previews.buy).toEqual({ value: null, error: null, loading: false });
    expect(readContract).not.toHaveBeenCalled();
  });
  it('close: quoteClose + executedClose → minProceeds; size above the position is a guard; without an account only the view quote', async () => {
    await mountConnected();
    act(() => api().preview.close('A', C2800, 2n * WAD));
    await advance(DEBOUNCE_MS);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS.A.pool, functionName: 'quoteClose', args: [ALL_SERIES[C2800]!.id.A, 2n * WAD] }));
    expect(api().previews.close).toEqual({ loading: false, error: null, value: { proceeds: 993_178n, sigma: 599_000_000_000_000_000n, exec: 993_533n, minProceeds: minProceeds(993_533n) } });
    act(() => api().preview.close('A', C2800, 6n * WAD));
    await advance(DEBOUNCE_MS);
    expect(api().previews.close).toEqual({ value: null, error: 'size exceeds position (5.00)', loading: false });
    vi.mocked(executedClose).mockClear();
    act(() => api().preview.close('A', C2800, WAD, null));                                // acct null eksplisit = tanpa simulasi
    await advance(DEBOUNCE_MS);
    expect(vi.mocked(executedClose)).not.toHaveBeenCalled();
    expect(api().previews.close.value).toMatchObject({ proceeds: 993_178n, exec: null, minProceeds: null });
  });
  it('deposit / redeem previews call previewDeposit / previewRedeem on the pool; empty input resets', async () => {
    await mountConnected();
    act(() => { api().preview.deposit('B', 100_000_000n); api().preview.redeem('A', 50_000_000n); });
    await advance(DEBOUNCE_MS);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS.B.pool, functionName: 'previewDeposit', args: [100_000_000n] }));
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS.A.pool, functionName: 'previewRedeem', args: [50_000_000n] }));
    expect(api().previews.deposit).toEqual({ value: 99_999_999n, error: null, loading: false });
    expect(api().previews.redeem).toEqual({ value: 50_000_001n, error: null, loading: false });
    act(() => api().preview.deposit('B', null));
    await advance(DEBOUNCE_MS);
    expect(api().previews.deposit).toEqual({ value: null, error: null, loading: false });
  });
  it('user / needsApprove follow the snapshot account; parseAmount handles decimals, blanks and junk', async () => {
    await mountConnected(withUser(liveSnapshot(), { allowance: { A: ALLOWANCE_MIN - 1n } }));
    expect(api().user!.positions).toHaveLength(demoPositions().length);
    expect(api().needsApprove('A')).toBe(true);
    expect(api().needsApprove('B')).toBe(false);
    expect(parseAmount('100', 6)).toBe(100_000_000n);
    expect(parseAmount(' 0.1 ', 18)).toBe(SIZE);
    expect(parseAmount('', 6)).toBeNull(); expect(parseAmount('0', 6)).toBeNull(); expect(parseAmount('abc', 6)).toBeNull(); expect(parseAmount('-1', 6)).toBeNull();
  });
});
