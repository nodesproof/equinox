// trade.ts — pembangun calldata murni (tanpa DOM, tanpa client): satu-satunya sumber argumen tulis untuk panel Trade dan smoke test.
import type { Address } from 'viem';
import { POOLS, USDG, type PoolKey, type SeriesRef } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { mockUsdgAbi } from '../abi/mockUsdg';

export const MAX_UINT = 2n ** 256n - 1n;
/** Slippage 1 % (bps) untuk `maxPremiumAssets` di buy dan `minProceedsAssets` di close. */
export const SLIPPAGE_BPS = 100n;
/** Faucet MockUSDG: 100 000 USDG (6 dp) per klik. */
export const FAUCET_AMOUNT = 100_000n * 10n ** 6n;
/** Di bawah ambang ini (1 000 000 USDG) tombol Approve ditampilkan; approve selalu MAX_UINT. */
export const ALLOWANCE_MIN = 10n ** 12n;
/** Ukuran minimum kontrak (`cfg.minSize` = 0,01 unit, WAD). */
export const MIN_SIZE = 10n ** 16n;

/** maxPremium = (premi + fee) × (1 + slippage), dibulatkan ke bawah — kontrak membandingkan premi+fee terhadap batas ini. */
export const maxPremium = (premium: bigint, fee: bigint) => ((premium + fee) * (10_000n + SLIPPAGE_BPS)) / 10_000n;
/** minProceeds = proceeds × (1 − slippage), dibulatkan ke bawah. */
export const minProceeds = (proceeds: bigint) => (proceeds * (10_000n - SLIPPAGE_BPS)) / 10_000n;

/** Bentuk longgar yang diterima `simulateContract`/`writeContract`/`estimateContractGas` (ABI dilebarkan agar bisa dilewatkan sebagai satu tipe). */
export interface TradeCall { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }

const pool = (k: PoolKey) => ({ address: POOLS[k].pool, abi: equinoxPoolAbi } as const);
export const buyCall = (k: PoolKey, id: bigint, size: bigint, premium: bigint, fee: bigint) => ({ ...pool(k), functionName: 'buy', args: [id, size, maxPremium(premium, fee)] } as const);
export const closeCall = (k: PoolKey, id: bigint, size: bigint, proceeds: bigint) => ({ ...pool(k), functionName: 'close', args: [id, size, minProceeds(proceeds)] } as const);
export const claimCall = (k: PoolKey, id: bigint, amount: bigint) => ({ ...pool(k), functionName: 'claim', args: [id, amount] } as const);
export const depositCall = (k: PoolKey, assets: bigint, receiver: Address) => ({ ...pool(k), functionName: 'deposit', args: [assets, receiver] } as const);
/** redeem(shares, receiver = owner, owner) — share dibakar dari dan aset dikirim ke wallet yang sama. */
export const redeemCall = (k: PoolKey, shares: bigint, owner: Address) => ({ ...pool(k), functionName: 'redeem', args: [shares, owner, owner] } as const);
export const approveCall = (k: PoolKey) => ({ address: USDG, abi: mockUsdgAbi, functionName: 'approve', args: [POOLS[k].pool, MAX_UINT] } as const);
export const faucetCall = (to: Address, amount = FAUCET_AMOUNT) => ({ address: USDG, abi: mockUsdgAbi, functionName: 'mint', args: [to, amount] } as const);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Label seri untuk select/log: `C 2800 #0 (25 Sep)`. */
export function seriesLabel(s: SeriesRef): string {
  const d = new Date(s.expiry * 1000);
  return `${s.isCall ? 'C' : 'P'} ${s.strike} #${s.boardId} (${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]})`;
}

/** Pesan manusiawi untuk error kontrak yang mungkin dilihat trader. */
export const REVERT_TEXT: Record<string, string> = {
  OracleStale: 'Spot is stale (Chainlink round older than 3 h or sequencer grace) — quotes are refused until a fresh round.',
  UtilizationExceeded: 'Reserve cap reached (80 % of the lagged capital reference) — new LP capital counts after 1–2 days.',
  VegaCapExceeded: 'Vega cap reached (5 % of the capital reference).', SlippageExceeded: 'Price moved beyond 1 % slippage — refresh and retry.',
  SeriesExpired: 'Series is in the 60-second blackout or expired — wait for settlement, then claim.', SeriesSettled: 'Series is settled — use claim.',
  SizeTooSmall: 'Minimum size is 0.01 units.', TradingIsPaused: 'Trading is paused by the owner (close/claim/withdraw still work).',
  MathUnavailable: 'Math program unavailable — deposits are refused until it is back (withdrawals still work).', NotSettled: 'Board not settled yet.',
  ERC20InsufficientBalance: 'Not enough USDG — use the faucet.', ERC20InsufficientAllowance: 'Approve USDG for this pool first.',
  ERC4626ExceededMaxRedeem: 'Not enough LP shares (or the pool cannot free that much liquidity right now) — redeem fewer shares.',
  ERC4626ExceededMaxWithdraw: 'The pool cannot free that much liquidity right now — withdraw less.',
  ERC4626ExceededMaxDeposit: 'Deposit exceeds the pool\'s maximum right now.',
  ERC1155InsufficientBalance: 'Not enough option units in your wallet for this series — close or claim at most your position.',
};
