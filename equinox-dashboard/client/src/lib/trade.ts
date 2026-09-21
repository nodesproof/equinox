// trade.ts — helper murni halaman Trade & Portfolio: teks pratinjau dan baris log persis panel klasik `web/src/panels/trade.ts`, opsi select
// (seri terbuka per pool / posisi yang dipegang), pemilihan default `fill()` klasik, nilai LP = share × NAV/share, daftar pool per jenis aset.
// Tidak ada matematika harga: semua angka datang dari snapshot/selector/useTrade dan hanya diberi format di sini.
import { POOLS, POOL_KEYS, type PoolKey } from '@chain/deployment';
import { usdg, usdg6, wad } from '@chain/ui/format';
import { ALLOWANCE_MIN, FAUCET_AMOUNT, SLIPPAGE_BPS, seriesLabel } from '@chain/chain/trade';
import type { BuyPreview, ClaimPreview, ClosePreview } from '@/chain/useTrade';
import { ASSET_SCALE, type PoolView, type PositionView, type SeriesView } from '@/chain/selectors';
import type { TxEntry } from '@/chain/types';

/** Faucet ETH Sepolia (gas) — tautan yang sama dengan panel klasik. */
export const ETH_FAUCET = 'https://faucet.quicknode.com/arbitrum/sepolia';
/** "1 %" — dari SLIPPAGE_BPS (100 bps), bukan literal. */
export const SLIPPAGE_PCT = `${Number(SLIPPAGE_BPS) / 100} %`;
/** "1,000,000" — ambang tombol approve (ALLOWANCE_MIN, 6 dp). */
export const ALLOWANCE_MIN_TEXT = usdg(ALLOWANCE_MIN, 0);
/** Label tombol faucet MockUSDG: `Faucet 100,000 USDG`. */
export const FAUCET_LABEL = `Faucet ${usdg(FAUCET_AMOUNT, 0)} USDG`;
/** Teks tautan faucet Paxos (Pool C): tidak ada mint on-chain, 100 USDG per wallet per hari. */
export const PAXOS_FAUCET_LABEL = 'Get 100 USDG/day at faucet.paxos.com ↗';

/** Pool ber-aset mock (mint terbuka) / ber-aset Paxos, dari manifest. */
export const mintPools = (): PoolKey[] => POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint');
export const paxosPools = (): PoolKey[] => POOL_KEYS.filter((k) => POOLS[k].faucet === 'paxos');
/** "A and B" / "A, B and C" / "A". */
export const listPools = (ks: PoolKey[]): string => (ks.length <= 1 ? ks.join('') : `${ks.slice(0, -1).join(', ')} and ${ks[ks.length - 1]}`);
/** Kata aset untuk pool switch: "mock USDG · open faucet" / "Paxos USDG (testnet)". */
export const assetWord = (k: PoolKey) => (POOLS[k].faucet === 'paxos' ? `Paxos ${POOLS[k].assetSymbol} (testnet)` : `mock ${POOLS[k].assetSymbol} · open faucet`);

// ---------------------------------------------------------------- opsi select

export interface SelectOption { i: number; text: string }
/** Seri yang bisa dibeli di pool k = status `open` (tidak settled, expiry > blockTime + 60) — `openRows()` klasik. */
export const openSeriesOptions = (rows: SeriesView[], k: PoolKey): SelectOption[] => rows.filter((r) => r.status[k] === 'open').map((r) => ({ i: r.i, text: seriesLabel(r.ref) }));
/** Posisi yang dipegang di pool k (`heldRows(settled)` klasik): `C 2800 #0 (25 Sep) — 5.00 units`. */
export const heldOptions = (positions: PositionView[], k: PoolKey, settled: boolean): SelectOption[] =>
  positions.filter((p) => p.k === k && p.settled === settled).map((p) => ({ i: p.i, text: `${seriesLabel(p.ref)} — ${wad(p.units, 2)} units` }));
/** Pilihan efektif: yang diminta bila ada di daftar, selain itu null (select menampilkan placeholder dan klik tombol mendapat guard
 *  "pick a series and a size") — TIDAK jatuh diam-diam ke opsi pertama seperti `fill()` klasik, agar deep link `?series=` yang tidak cocok
 *  (mis. seri settled di select Buy) tidak berubah menjadi seri lain tanpa pengguna sadar. */
export const pickOption = (options: SelectOption[], wanted: number | null): number | null => (wanted !== null && options.some((o) => o.i === wanted) ? wanted : null);

// ---------------------------------------------------------------- teks pratinjau (panel klasik, verbatim)

/** `premium X + fee Y = Z USDG (indicative) · σ … · Δ …` + ` · executed ≈ … USDG (max …)` bila simulasi jalur eksekusi lolos. */
export const buyPreviewText = (p: BuyPreview, symbol: string): string =>
  `premium ${usdg6(p.premium)} + fee ${usdg6(p.fee)} = ${usdg6(p.premium + p.fee)} ${symbol} (indicative) · σ ${wad(p.sigma, 3)} · Δ ${wad(p.delta, 2)}`
  + (p.exec !== null && p.feeExec !== null && p.maxPremium !== null ? ` · executed ≈ ${usdg6(p.exec + p.feeExec)} ${symbol} (max ${usdg6(p.maxPremium)})` : '');
/** `proceeds X USDG (indicative) · σ_close …` + ` · executed ≈ … USDG (min …)`. */
export const closePreviewText = (p: ClosePreview, symbol: string): string =>
  `proceeds ${usdg6(p.proceeds)} ${symbol} (indicative) · σ_close ${wad(p.sigma, 3)}`
  + (p.exec !== null && p.minProceeds !== null ? ` · executed ≈ ${usdg6(p.exec)} ${symbol} (min ${usdg6(p.minProceeds)})` : '');
/** `5.00 units × 100.000000 = 500.000000 USDG` — payoutPerUnit WAD → aset 6 dp lewat ÷ 1e12. */
export const claimPreviewText = (p: ClaimPreview, symbol: string): string => `${wad(p.units, 2)} units × ${usdg6(p.payoutPerUnit / ASSET_SCALE)} = ${usdg6(p.payout)} ${symbol}`;
export const depositPreviewText = (shares: bigint): string => `→ ${usdg6(shares)} shares`;
export const redeemPreviewText = (assets: bigint, symbol: string): string => `→ ${usdg6(assets)} ${symbol}`;

// ---------------------------------------------------------------- log tx

export type TxLineState = 'ok' | 'bad' | 'pending';
export const txLineState = (e: TxEntry): TxLineState => (e.ok === null ? 'pending' : e.ok ? 'ok' : 'bad');
/** Awalan baris log klasik: `✓ what — ` / `✗ what — ` / `… what — ` (ekor: pesan revert, tautan tx, atau "pending"). */
export const txLinePrefix = (e: TxEntry): string => `${e.ok === null ? '…' : e.ok ? '✓' : '✗'} ${e.what} — `;
/** Ekor teks: pesan gagal (decodeRevert) atau, saat pending, tahap yang sedang berjalan. */
export const txLineTail = (e: TxEntry): string => (e.ok === null ? 'pending — simulate → wallet → receipt' : e.tail);

// ---------------------------------------------------------------- portfolio

/** Nilai LP (aset 6 dp) = share × totalAssets / totalSupply — rasio NAV/share yang sama dengan `PoolDerived.navPerShare`, dihitung bigint; null tanpa share di pool. */
export const lpValue = (shares: bigint, pool: Pick<PoolView, 'totalAssets' | 'totalSupply'>): bigint | null => (pool.totalSupply === 0n ? null : (shares * pool.totalAssets) / pool.totalSupply);
/** Kunci posisi untuk peta nilai close on-demand: `B:3`. */
export const positionKey = (p: Pick<PositionView, 'k' | 'i'>) => `${p.k}:${p.i}`;
