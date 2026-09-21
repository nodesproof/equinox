// test/pages/trade.test.tsx — Trade dirender dari fixture ChainContext (client.readContract di-inject, @chain/chain/wallet di-mock, tanpa jaringan):
// read-only tanpa wallet (tombol nonaktif + teks faucet QuickNode), Pool C (tanpa tombol mint, tautan Paxos, label approve Paxos), buy → run dengan
// builder yang menghasilkan maxPremium(premExec, scaleFee(...)), close → minProceeds(executedClose), guard sebelum RPC, busy/wrong network,
// TxLog (aria-live, ✓/✗, tautan untuk TxFailed), teks pratinjau panel klasik, prefill ?pool=&series= + hashchange, pratinjau diterbitkan ulang per snapshot.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatUnits } from 'viem';
import { ALL_SERIES, PAXOS_FAUCET, POOLS, POOL_KEYS, WAD, explorerTx } from '@chain/deployment';
import type { Client } from '@chain/chain/client';
import { executedBuy, executedClose } from '@chain/chain/wallet';
import { FAUCET_AMOUNT, MAX_UINT, REVERT_TEXT, approveCall, assetLabel, buyCall, claimCall, closeCall, depositCall, faucetCall, maxPremium, minProceeds, redeemCall, scaleFee, seriesLabel } from '@chain/chain/trade';
import { usdg, shortHash, wad } from '@chain/ui/format';
import Trade from '@/pages/Trade';
import { DEBOUNCE_MS } from '@/chain/useTrade';
import { seriesViews, userView } from '@/chain/selectors';
import type { BuildCall, ChainState, TxEntry } from '@/chain/types';
import { NETWORK_NAME } from '@/components/Layout';
import { tradeHref } from '@/lib/route';
import { ALLOWANCE_MIN_TEXT, ETH_FAUCET, FAUCET_LABEL, PAXOS_FAUCET_LABEL, buyPreviewText, claimPreviewText, closePreviewText, depositPreviewText, openSeriesOptions, redeemPreviewText } from '@/lib/trade';
import { Providers, renderWithChain } from '../render';
import { USER, chainState, liveParity, liveSnapshot, withSettled, withUser, type StateOverrides } from '../fixtures/snapshot';

vi.mock('@chain/chain/wallet', async (orig) => ({ ...(await orig<typeof import('@chain/chain/wallet')>()), executedBuy: vi.fn(), executedClose: vi.fn() }));

/** Kuotasi view seperti test useTrade: premi 268.181826 + fee 8.045455; eksekusi 270.000000 (post-poke). */
const Q = { premiumAssets: 268_181_826n, feeAssets: 8_045_455n, sigma: 661_300_000_000_000_000n, delta: 550_000_000_000_000_000n, vegaTotal: 3n * WAD, spotWad: 2_579n * WAD };
const PREM_EXEC = 270_000_000n, EXEC_CLOSE = 993_533n;
const CLOSE_Q = [993_178n, 599_000_000_000_000_000n, 2_579n * WAD] as const;
const readContract = vi.fn();
const client = { readContract } as unknown as Client;
const idx = (boardId: number, strike: number, isCall: boolean) => ALL_SERIES.findIndex((s) => s.boardId === boardId && s.strike === strike && s.isCall === isCall);
const C2800 = idx(0, 2800, true), P2400 = idx(0, 2400, false), C2600_1 = idx(1, 2600, true);
const SIZE = 10n ** 17n;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setValue = (id: string, value: string) => fireEvent.change(el(id), { target: { value } });
const button = (name: RegExp | string) => screen.getByRole('button', { name });
const poolRadio = (k: string) => screen.getByRole('radio', { name: new RegExp(`^Pool ${k}`) });
/** Fixture terhubung: snapshot ber-akun USER (posisi demo), wallet ada, `run` dimata-matai. */
const connected = (over: StateOverrides = {}): StateOverrides => ({ snapshot: withUser(liveSnapshot()), hasWallet: true, client, run: vi.fn(async () => {}), ...over });
const lastRun = (state: ChainState) => { const c = vi.mocked(state.run).mock.calls.at(-1)!; return { what: c[0] as string, build: c[1] as BuildCall, k: c[2] }; };

beforeEach(() => {
  vi.useFakeTimers();
  readContract.mockReset().mockImplementation(async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
    if (functionName === 'quoteBuy') return Q;
    if (functionName === 'quoteClose') return CLOSE_Q;
    if (functionName === 'previewDeposit') return args[0]! - 1n;
    if (functionName === 'previewRedeem') return args[0]! + 1n;
    throw new Error(`unexpected readContract ${functionName}`);
  });
  vi.mocked(executedBuy).mockReset().mockResolvedValue(PREM_EXEC);
  vi.mocked(executedClose).mockReset().mockResolvedValue(EXEC_CLOSE);
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.location.hash = ''; });

describe('Trade — wallet states', () => {
  it('no injected wallet: read-only note with the QuickNode ETH faucet link, every action button disabled, previews stay indicative (no simulation)', async () => {
    renderWithChain(<Trade />, { snapshot: liveSnapshot(), hasWallet: false, client });
    expect(screen.getByRole('heading', { level: 2, name: 'Trade' })).toBeInTheDocument();
    const note = screen.getByTestId('trade-note');
    expect(note).toHaveAttribute('data-kind', 'no-wallet');
    expect(note).toHaveTextContent(/No injected wallet found — the panel is read-only/);
    expect(within(note).getByRole('link', { name: /QuickNode faucet/ })).toHaveAttribute('href', ETH_FAUCET);
    if (POOL_KEYS.some((k) => POOLS[k].faucet === 'paxos')) expect(within(note).getByRole('link', { name: /faucet\.paxos\.com/ })).toHaveAttribute('href', PAXOS_FAUCET);
    expect(screen.getByText('read-only · no wallet')).toBeInTheDocument();
    for (const name of [/^Deposit$/, /^Redeem$/, /^Buy$/, /^Close$/, /^Claim$/]) expect(button(name)).toBeDisabled();
    if (POOLS.B.faucet === 'mint') expect(button(FAUCET_LABEL)).toBeDisabled();
    expect(el<HTMLSelectElement>('close-series')).toBeDisabled();
    expect(within(el('close-series')).getByRole('option')).toHaveTextContent('connect wallet to see positions');
    expect(screen.getByLabelText('Your wallet on pool B')).toHaveTextContent(/No injected wallet/);
    // Indicative quote after the debounce; no executedBuy without an account.
    expect(el('buy-preview')).toHaveTextContent('…');
    await advance(DEBOUNCE_MS);
    expect(el('buy-preview')).toHaveTextContent(buyPreviewText({ premium: Q.premiumAssets, fee: Q.feeAssets, sigma: Q.sigma, delta: Q.delta, vega: Q.vegaTotal, exec: null, feeExec: null, maxPremium: null }, POOLS.B.assetSymbol));
    expect(el('buy-preview')).toHaveTextContent('(indicative)');
    expect(el('buy-preview')).not.toHaveTextContent('executed');
    expect(vi.mocked(executedBuy)).not.toHaveBeenCalled();
  });

  it('wrong network: "Switch to Arbitrum Sepolia" and disabled actions; busy: actions and the pool switch disabled', () => {
    const { unmount } = renderWithChain(<Trade />, connected({ wrongChain: true }));
    expect(screen.getByText('wrong network')).toBeInTheDocument();
    expect(button(new RegExp(`Switch to ${NETWORK_NAME}`))).toBeInTheDocument();
    for (const name of [/^Deposit$/, /^Redeem$/, /^Buy$/, /^Close$/, /^Claim$/]) expect(button(name)).toBeDisabled();
    unmount();
    renderWithChain(<Trade />, connected({ busy: true }));
    for (const name of [/^Deposit$/, /^Redeem$/, /^Buy$/, /^Close$/, /^Claim$/]) expect(button(name)).toBeDisabled();
    for (const k of POOL_KEYS) expect(poolRadio(k)).toBeDisabled();
    expect(screen.getByText('action in flight')).toBeInTheDocument();
  });

  it('connected: gas note, wallet summary for the selected pool (balance with the asset label, shares, allowance, positions), enabled actions', () => {
    const s = withUser(liveSnapshot());
    renderWithChain(<Trade />, connected({ snapshot: s }));
    expect(screen.getByTestId('trade-note')).toHaveAttribute('data-kind', 'gas');
    expect(screen.getByTestId('trade-note')).toHaveTextContent(/1 % slippage caps \(max premium \+ fee, min proceeds\) come from a simulation of the executed path/);
    expect(screen.getByText('connected')).toBeInTheDocument();
    const panel = screen.getByLabelText('Your wallet on pool B');
    const u = s.user!;
    expect(within(panel).getByText(`${usdg(u.asset.B)} ${assetLabel('B')}`)).toBeInTheDocument();
    expect(within(panel).getByText('approved')).toBeInTheDocument();
    const held = userView(s, USER)!.positions.filter((p) => p.k === 'B');
    expect(within(panel).getByText(held.map((p) => `${wad(p.units, 2)} ${seriesLabel(p.ref)}`).join(', '))).toBeInTheDocument();
    for (const name of [/^Deposit$/, /^Redeem$/, /^Buy$/, /^Close$/, /^Claim$/]) expect(button(name)).toBeEnabled();
    // Open-series select = status `open` on the pool (not settled, expiry > blockTime + 60 — the classic openRows()).
    const opts = Array.from(el<HTMLSelectElement>('buy-series').options).map((o) => o.textContent);
    expect(opts).toEqual(openSeriesOptions(seriesViews(s, liveParity(s)), 'B').map((o) => o.text));
    expect(opts).toHaveLength(seriesViews(s, liveParity(s)).filter((r) => r.status.B === 'open').length);
  });
});

describe('Trade — asset per pool', () => {
  it('Pool C: no mint button, the faucet.paxos.com link, approve labelled "USDG (Paxos)" when allowance < ALLOWANCE_MIN; mint pools show the faucet button', () => {
    if (!POOL_KEYS.includes('C')) return;
    window.location.hash = tradeHref('C');
    renderWithChain(<Trade />, connected({ snapshot: withUser(liveSnapshot(), { allowance: { C: 0n } }) }));
    expect(poolRadio('C')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /^Faucet/ })).toBeNull();
    const link = screen.getByTestId('paxos-faucet');
    expect(link).toHaveAttribute('href', PAXOS_FAUCET);
    expect(link).toHaveTextContent(PAXOS_FAUCET_LABEL);
    expect(button('Approve USDG (Paxos) for pool C')).toBeEnabled();
    expect(screen.getByText(`USDG (Paxos) allowance for pool C is below ${ALLOWANCE_MIN_TEXT} — approve once (MAX).`)).toBeInTheDocument();
    expect(screen.getByLabelText('Your wallet on pool C')).toHaveTextContent('not approved');
    // Switch to a mint pool: faucet button present, approve hidden (allowance MAX).
    fireEvent.click(poolRadio('A'));
    expect(button(`Faucet ${usdg(FAUCET_AMOUNT, 0)} USDG`)).toBeEnabled();
    expect(screen.queryByTestId('paxos-faucet')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.getByText('USDG (mock) allowance for pool A: approved.')).toBeInTheDocument();
  });

  it('faucet / approve / deposit / redeem / claim hand ChainState.run the classic `what` and the pure builders', async () => {
    const settled = withUser(withSettled(liveSnapshot(), 0, 2900));
    const { state } = renderWithChain(<Trade />, connected({ snapshot: settled }));
    fireEvent.click(poolRadio('A'));
    fireEvent.click(button(FAUCET_LABEL));
    expect(lastRun(state).what).toBe(`faucet ${usdg(FAUCET_AMOUNT, 0)} USDG (mock)`);
    expect(await lastRun(state).build('A', USER)).toEqual(faucetCall('A', USER));
    setValue('deposit-assets', '100');
    fireEvent.click(button(/^Deposit$/));
    expect(lastRun(state)).toMatchObject({ what: 'deposit 100.00 USDG into A', k: 'A' });
    expect(await lastRun(state).build('A', USER)).toEqual(depositCall('A', 100_000_000n, USER));
    fireEvent.click(screen.getByRole('button', { name: /Redeem all your LP shares/ }));
    expect(el<HTMLInputElement>('redeem-shares').value).toBe(formatUnits(settled.user!.shares.A, 6));
    fireEvent.click(button(/^Redeem$/));
    expect(lastRun(state).what).toBe(`redeem ${(Number(settled.user!.shares.A) / 1e6).toFixed(6)} shares from A`);
    expect(await lastRun(state).build('A', USER)).toEqual(redeemCall('A', settled.user!.shares.A, USER));
    // Claim: settled position with a payout (C 2800 #0 → 100/unit × 5 units) — the select lists settled positions only.
    const claimSel = el<HTMLSelectElement>('claim-series');
    expect(Array.from(claimSel.options).map((o) => o.value)).toEqual(userView(settled, USER)!.positions.filter((p) => p.k === 'A' && p.settled).map((p) => String(p.i)));
    setValue('claim-series', String(C2800));
    const claim = userView(settled, USER)!.positions.find((p) => p.k === 'A' && p.i === C2800)!;
    expect(el('claim-preview')).toHaveTextContent(claimPreviewText({ units: claim.units, payoutPerUnit: claim.payoutPerUnit, payout: claim.claimable }, 'USDG'));
    expect(el('claim-preview')).toHaveTextContent('5.00 units × 100.000000 = 500.000000 USDG');
    fireEvent.click(button(/^Claim$/));
    expect(lastRun(state).what).toBe(`claim 5.00 ${seriesLabel(ALL_SERIES[C2800]!)} on A`);
    expect(await lastRun(state).build('A', USER)).toEqual(claimCall('A', ALL_SERIES[C2800]!.id.A, 5n * WAD));
    // Approve on a pool below the threshold targets POOLS[k].asset with MAX_UINT.
    cleanup();
    const second = renderWithChain(<Trade />, connected({ snapshot: withUser(liveSnapshot(), { allowance: { B: 0n } }) }));
    fireEvent.click(button('Approve USDG (mock) for pool B'));
    expect(lastRun(second.state).what).toBe('approve USDG (mock) for B');
    expect(await lastRun(second.state).build('B', USER)).toEqual(approveCall('B'));
    expect((await lastRun(second.state).build('B', USER)).args).toEqual([POOLS.B.pool, MAX_UINT]);
  });
});

describe('Trade — buy and close hand run() builders whose caps come from the executed path', () => {
  it('buy: run("buy 0.10 C 2600 #1 (2 Oct) on B", build) and build() → quoteBuy → executedBuy → buyCall with maxPremiumAssets = maxPremium(premExec, scaleFee(feeQ, premQ, premExec))', async () => {
    const { state } = renderWithChain(<Trade />, connected());
    setValue('buy-series', String(C2600_1));
    setValue('buy-size', '0.1');
    fireEvent.click(button(/^Buy$/));
    const { what, build, k } = lastRun(state);
    expect(what).toBe(`buy 0.10 ${seriesLabel(ALL_SERIES[C2600_1]!)} on B`);
    expect(k).toBe('B');
    const ref = ALL_SERIES[C2600_1]!;
    const call = await build('B', USER);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: POOLS.B.pool, functionName: 'quoteBuy', args: [ref.id.B, SIZE] }));
    expect(vi.mocked(executedBuy)).toHaveBeenCalledWith('B', ref.id.B, SIZE, USER);
    const fee = scaleFee(Q.feeAssets, Q.premiumAssets, PREM_EXEC);
    expect(call).toEqual(buyCall('B', ref.id.B, SIZE, PREM_EXEC, fee));
    expect((call.args as bigint[])[2]).toBe(maxPremium(PREM_EXEC, fee));
    expect((call.args as bigint[])[2]).toBe(280_881_001n);
  });

  it('close: run("close 2.00 C 2800 #0 (25 Sep) on A", build) and build() → closeCall with minProceedsAssets = minProceeds(executedClose) — never quoteClose', async () => {
    window.location.hash = tradeHref('A', C2800);
    const { state } = renderWithChain(<Trade />, connected());
    expect(poolRadio('A')).toHaveAttribute('aria-checked', 'true');
    expect(el<HTMLSelectElement>('close-series').value).toBe(String(C2800));
    setValue('close-size', '2');
    fireEvent.click(button(/^Close$/));
    const { what, build } = lastRun(state);
    expect(what).toBe(`close 2.00 ${seriesLabel(ALL_SERIES[C2800]!)} on A`);
    readContract.mockClear();
    const call = await build('A', USER);
    expect(vi.mocked(executedClose)).toHaveBeenCalledWith('A', ALL_SERIES[C2800]!.id.A, 2n * WAD, USER);
    expect(readContract).not.toHaveBeenCalled();
    expect(call).toEqual(closeCall('A', ALL_SERIES[C2800]!.id.A, 2n * WAD, EXEC_CLOSE));
    expect((call.args as bigint[])[2]).toBe(minProceeds(EXEC_CLOSE));
    expect((call.args as bigint[])[2]).toBe(983_597n);
  });

  it('guards run before any RPC and show inline: size < MIN_SIZE, size above the position, empty amounts', async () => {
    const { state } = renderWithChain(<Trade />, connected());
    setValue('buy-size', '0.001');
    fireEvent.click(button(/^Buy$/));
    expect(screen.getByText(REVERT_TEXT.SizeTooSmall!)).toHaveAttribute('role', 'status');
    setValue('close-series', String(C2800));
    setValue('close-size', '6');
    fireEvent.click(button(/^Close$/));
    expect(screen.getByText('size exceeds your position (5.00 units)')).toBeInTheDocument();
    fireEvent.click(button(/^Deposit$/));
    expect(screen.getByText('enter a USDG amount')).toBeInTheDocument();
    fireEvent.click(button(/^Redeem$/));
    expect(screen.getByText('enter a share amount')).toBeInTheDocument();
    fireEvent.click(button(/^Claim$/));
    expect(screen.getByText('nothing to claim', { selector: '.form-guard' })).toBeInTheDocument();
    expect(state.run).not.toHaveBeenCalled();
    expect(vi.mocked(executedBuy)).not.toHaveBeenCalled();
    expect(vi.mocked(executedClose)).not.toHaveBeenCalled();
  });
});

describe('Trade — previews (classic sentences) and their refresh', () => {
  it('buy/close/deposit/redeem previews after the debounce: indicative + "executed ≈ … (max …)" / "(min …)", "→ shares", "→ USDG"', async () => {
    const s = withUser(liveSnapshot());
    renderWithChain(<Trade />, connected({ snapshot: s }));
    setValue('buy-series', String(C2600_1));
    setValue('close-series', String(P2400));
    setValue('close-size', '0.5');
    setValue('deposit-assets', '100');
    fireEvent.click(screen.getByRole('button', { name: /Redeem all your LP shares/ }));
    await advance(DEBOUNCE_MS);
    const fee = scaleFee(Q.feeAssets, Q.premiumAssets, PREM_EXEC);
    const buy = buyPreviewText({ premium: Q.premiumAssets, fee: Q.feeAssets, sigma: Q.sigma, delta: Q.delta, vega: Q.vegaTotal, exec: PREM_EXEC, feeExec: fee, maxPremium: maxPremium(PREM_EXEC, fee) }, 'USDG');
    expect(el('buy-preview')).toHaveTextContent(buy);
    expect(buy).toBe('premium 268.181826 + fee 8.045455 = 276.227281 USDG (indicative) · σ 0.661 · Δ 0.55 · executed ≈ 278.100001 USDG (max 280.881001)');
    const close = closePreviewText({ proceeds: CLOSE_Q[0], sigma: CLOSE_Q[1], exec: EXEC_CLOSE, minProceeds: minProceeds(EXEC_CLOSE) }, 'USDG');
    expect(el('close-preview')).toHaveTextContent(close);
    expect(close).toBe('proceeds 0.993178 USDG (indicative) · σ_close 0.599 · executed ≈ 0.993533 USDG (min 0.983597)');
    expect(el('deposit-preview')).toHaveTextContent(depositPreviewText(100_000_000n - 1n));
    expect(el('redeem-preview')).toHaveTextContent(redeemPreviewText(s.user!.shares.B + 1n, 'USDG'));
    expect(vi.mocked(executedBuy)).toHaveBeenCalledWith('B', ALL_SERIES[C2600_1]!.id.B, SIZE, USER);
    expect(vi.mocked(executedClose)).toHaveBeenCalledWith('B', ALL_SERIES[P2400]!.id.B, 5n * 10n ** 17n, USER);
  });

  it('a failed simulation keeps the indicative quote; a failed view shows the decoded error; previews are re-issued when a new snapshot lands', async () => {
    vi.mocked(executedBuy).mockRejectedValue(new Error('no allowance'));
    const state = chainState(connected());
    const { rerender } = renderWithChain(<Trade />, state);
    await advance(DEBOUNCE_MS);
    expect(el('buy-preview')).toHaveTextContent('(indicative)');
    expect(el('buy-preview')).not.toHaveTextContent('executed');
    const quoteCalls = () => readContract.mock.calls.filter((c) => (c[0] as { functionName: string }).functionName === 'quoteBuy').length;
    expect(quoteCalls()).toBe(1);
    // Controller ruling: a new snapshot re-issues the previews with the current field values (displayed values ≤ 1 poll old).
    const next = chainState({ ...connected(), snapshot: withUser(liveSnapshot()), run: state.run });
    rerender(<Providers state={next}><Trade /></Providers>);
    await advance(DEBOUNCE_MS);
    expect(quoteCalls()).toBe(2);
    readContract.mockImplementation(async () => { throw new Error('view failed (stub)'); });
    const third = chainState({ ...connected(), snapshot: withUser(liveSnapshot()), run: state.run });
    rerender(<Providers state={third}><Trade /></Providers>);
    await advance(DEBOUNCE_MS);
    expect(el('buy-preview')).toHaveTextContent('view failed (stub)');
    expect(el('buy-preview')).toHaveClass('preview-line--bad');
  });
});

describe('Trade — prefill and log', () => {
  it('prefills pool and series from #/trade?pool=&series= on mount and follows hashchange; invalid values are ignored', () => {
    window.location.hash = tradeHref('A', C2600_1);
    renderWithChain(<Trade />, connected());
    expect(poolRadio('A')).toHaveAttribute('aria-checked', 'true');
    expect(el<HTMLSelectElement>('buy-series').value).toBe(String(C2600_1));
    act(() => { window.location.hash = tradeHref('B', P2400); window.dispatchEvent(new Event('hashchange')); });
    expect(poolRadio('B')).toHaveAttribute('aria-checked', 'true');
    expect(el<HTMLSelectElement>('buy-series').value).toBe(String(P2400));
    expect(el<HTMLSelectElement>('close-series').value).toBe(String(P2400));
    act(() => { window.location.hash = '#/trade?pool=Z&series=999999'; window.dispatchEvent(new Event('hashchange')); });
    expect(poolRadio('B')).toHaveAttribute('aria-checked', 'true');
    expect(el<HTMLSelectElement>('buy-series').value).toBe(String(P2400));
    // Keyboard: arrow keys move the pool radio.
    fireEvent.keyDown(poolRadio('B'), { key: 'ArrowRight' });
    expect(poolRadio(POOL_KEYS[(POOL_KEYS.indexOf('B') + 1) % POOL_KEYS.length]!)).toHaveAttribute('aria-checked', 'true');
  });

  it('TxLog: aria-live list, ✓ line with the tx link, ✗ line with the decoded message, TxFailed keeps its explorer link, pending line', () => {
    const hash = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
    const at = Date.now();
    const txLog: TxEntry[] = [
      { id: 4, ok: null, what: 'close 0.50 P 2400 #0 (25 Sep) on B', tail: '', atMs: at },
      { id: 3, ok: false, what: 'buy 0.10 C 2600 #1 (2 Oct) on B', tail: 'Transaction reverted on-chain (status 0)', hash, atMs: at },
      { id: 2, ok: true, what: 'approve USDG (mock) for B', tail: '', hash, atMs: at },
      { id: 1, ok: false, what: 'faucet 100,000 USDG (mock)', tail: 'User rejected the request.', atMs: at },
    ];
    renderWithChain(<Trade />, connected({ txLog }));
    const list = screen.getByRole('list', { hidden: false });
    expect(list).toHaveClass('txlog');
    expect(list).toHaveAttribute('aria-live', 'polite');
    const lines = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      '… close 0.50 P 2400 #0 (25 Sep) on B — pending — simulate → wallet → receipt',
      `✗ buy 0.10 C 2600 #1 (2 Oct) on B — Transaction reverted on-chain (status 0) tx ${shortHash(hash)} ↗`,
      `✓ approve USDG (mock) for B — tx ${shortHash(hash)} ↗`,
      '✗ faucet 100,000 USDG (mock) — User rejected the request.',
    ]);
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const a of links) { expect(a).toHaveAttribute('href', explorerTx(hash)); expect(a).toHaveAttribute('rel', 'noopener noreferrer'); }
    expect(within(list).getAllByRole('listitem')[1]).toHaveAttribute('data-state', 'bad');
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute('data-state', 'pending');
    expect(screen.getByText('4 entries · 2 failed')).toBeInTheDocument();
  });

  it('empty log and skeleton: "No transactions yet."; without a snapshot the selects carry the reason and no number is shown', () => {
    renderWithChain(<Trade />, { snapshot: null, hasWallet: true, client });
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
    expect(within(el('buy-series')).getByRole('option')).toHaveTextContent('Awaiting snapshot');
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(1);
    expect(el('buy-preview')).toHaveAttribute('data-state', 'idle');
  });
});
