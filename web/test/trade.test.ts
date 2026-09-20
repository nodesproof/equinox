// test/trade.test.ts — unit tanpa jaringan: pembangun calldata, matematika slippage, label seri, tabel pesan revert.
import { describe, expect, it } from 'vitest';
import { toFunctionSelector } from 'viem';
import { ALL_SERIES, POOLS, USDG } from '../src/deployment';
import { REVERT_SELECTOR } from '../src/chain/wallet';
import {
  ALLOWANCE_MIN, FAUCET_AMOUNT, MAX_UINT, MIN_SIZE, REVERT_TEXT, SLIPPAGE_BPS, approveCall, buyCall, claimCall, closeCall, depositCall, faucetCall, maxPremium, minProceeds,
  poolCall, redeemCall, scaleFee, seriesLabel,
} from '../src/chain/trade';

const addr = '0x90351bB1E85a17D5f70c62C0cC076D39D897076D' as const;

describe('slippage math (1 % = 100 bps)', () => {
  it('maxPremium = floor((premium + fee) × 1.01)', () => {
    // (268 181 826 + 8 045 455) × 1,01 = 278 989 553,81 → floor.
    expect(SLIPPAGE_BPS).toBe(100n);
    expect(maxPremium(268_181_826n, 8_045_455n)).toBe(278_989_553n);
    expect(maxPremium(0n, 0n)).toBe(0n);
    // scaleFee: fee eksekusi = fee kuotasi × premi eksekusi / premi kuotasi, dibulatkan ke bawah, +1 (fee on-chain = ceil(feeBps × premi)).
    // 8 045 455 × 270 000 000 / 268 181 826 = 8 100 000,22 → 8 100 000 + 1 (fee 300 bps pada 270 USDG = 8 100 000 tepat; +1 menutup pembulatan).
    expect(scaleFee(8_045_455n, 268_181_826n, 270_000_000n)).toBe(8_100_001n);
    expect(scaleFee(8_045_455n, 268_181_826n, 268_181_826n)).toBe(8_045_456n);
    expect(scaleFee(7n, 0n, 123n)).toBe(7n);
    // Batas dari jalur eksekusi: maxPremium(premExec, scaleFee(…)) ≥ premi eksekusi + fee on-chain (8 100 000) dengan slack 1 %.
    expect(maxPremium(270_000_000n, scaleFee(8_045_455n, 268_181_826n, 270_000_000n))).toBe(280_881_001n);
  });
  it('minProceeds = floor(proceeds × 0.99)', () => {
    expect(minProceeds(100_000_000n)).toBe(99_000_000n);
    expect(minProceeds(993_178n)).toBe(983_246n);
  });
});

describe('call builders (args match the ABI order)', () => {
  it('buy(seriesId, size, maxPremiumAssets) on the chosen pool', () => {
    expect(poolCall('A').address).toBe(POOLS.A.pool);
    expect(poolCall('B').address).toBe(POOLS.B.pool);
    const c = buyCall('B', 1n, 10n ** 18n, 5n, 1n);
    expect(c.functionName).toBe('buy');
    expect(c.address).toBe(POOLS.B.pool);
    expect(c.args).toEqual([1n, 10n ** 18n, (6n * 101n) / 100n]);
    expect(buyCall('A', 1n, 1n, 0n, 0n).address).toBe(POOLS.A.pool);
  });
  it('close(seriesId, size, minProceedsAssets)', () => {
    const c = closeCall('B', 7n, 10n ** 16n, 993_178n);
    expect(c.functionName).toBe('close');
    expect(c.args).toEqual([7n, 10n ** 16n, 983_246n]);
  });
  it('claim(seriesId, amount)', () => {
    expect(claimCall('A', 9n, 5n * 10n ** 18n)).toMatchObject({ address: POOLS.A.pool, functionName: 'claim', args: [9n, 5n * 10n ** 18n] });
  });
  it('deposit(assets, receiver) and redeem(shares, receiver = owner, owner)', () => {
    expect(depositCall('B', 10_000_000n, addr)).toMatchObject({ address: POOLS.B.pool, functionName: 'deposit', args: [10_000_000n, addr] });
    expect(redeemCall('B', 9_999_010n, addr)).toMatchObject({ address: POOLS.B.pool, functionName: 'redeem', args: [9_999_010n, addr, addr] });
  });
  it('approve(pool, MAX_UINT) on USDG; faucet = MockUSDG.mint(to, 100,000 USDG)', () => {
    expect(MAX_UINT).toBe(2n ** 256n - 1n);
    expect(approveCall('A')).toMatchObject({ address: USDG, functionName: 'approve', args: [POOLS.A.pool, MAX_UINT] });
    expect(approveCall('B').args[0]).toBe(POOLS.B.pool);
    const f = faucetCall(addr);
    expect(f).toMatchObject({ address: USDG, functionName: 'mint' });
    expect(f.args[0]).toBe(addr);
    expect(f.args[1]).toBe(100_000_000_000n);
    expect(FAUCET_AMOUNT).toBe(100_000_000_000n);
    expect(faucetCall(addr, 100_000_000n).args[1]).toBe(100_000_000n);
  });
  it('thresholds: approve shown below 1e12 (1,000,000 USDG); contract minSize 0.01 units', () => {
    expect(ALLOWANCE_MIN).toBe(10n ** 12n);
    expect(MIN_SIZE).toBe(10n ** 16n);
  });
});

describe('seriesLabel', () => {
  it('formats `C 2800 #0 (25 Sep)` from the manifest series', () => {
    const c2800 = ALL_SERIES.find((s) => s.boardId === 0 && s.strike === 2800 && s.isCall)!;
    expect(seriesLabel(c2800)).toBe('C 2800 #0 (25 Sep)');
    const p2200 = ALL_SERIES.find((s) => s.boardId === 1 && s.strike === 2200 && !s.isCall)!;
    expect(seriesLabel(p2200)).toBe('P 2200 #1 (2 Oct)');
  });
});

describe('REVERT_TEXT', () => {
  it('has 16 human messages keyed by custom error name (12 pool + 3 ERC-4626 + 1 ERC-1155 token error)', () => {
    expect(Object.keys(REVERT_TEXT)).toHaveLength(16);
    for (const k of ['OracleStale', 'UtilizationExceeded', 'VegaCapExceeded', 'SlippageExceeded', 'SeriesExpired', 'SeriesSettled', 'SizeTooSmall', 'TradingIsPaused', 'MathUnavailable', 'NotSettled', 'ERC20InsufficientBalance', 'ERC20InsufficientAllowance',
      'ERC4626ExceededMaxRedeem', 'ERC4626ExceededMaxWithdraw', 'ERC4626ExceededMaxDeposit', 'ERC1155InsufficientBalance']) {
      expect(REVERT_TEXT[k], k).toBeTruthy();
    }
  });
  it('maps the ERC-1155 selector (not in the pool ABI) to the same text', () => {
    expect(toFunctionSelector('ERC1155InsufficientBalance(address,uint256,uint256,uint256)')).toBe('0x03dee4c5');
    expect(REVERT_SELECTOR['0x03dee4c5']).toBe('ERC1155InsufficientBalance');
  });
});
