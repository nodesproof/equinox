// useTrade.ts — port `web/src/panels/trade.ts` tanpa DOM: pratinjau (debounce 250 ms + penjaga urutan per field) dan aksi wallet
// (faucet/approve/deposit/redeem/buy/close/claim) yang semuanya lewat ChainState.run. Semua calldata dari pembangun murni @chain/chain/trade;
// batas slippage buy/close dari JALUR EKSEKUSI (executedBuy/executedClose + scaleFee/maxPremium/minProceeds, brief §6.2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseUnits, type Address } from 'viem';
import { ALL_SERIES, PAXOS_FAUCET, POOLS, type PoolKey } from '@chain/deployment';
import { usdg, usdg6, wad } from '@chain/ui/format';
import { decodeRevert, executedBuy, executedClose } from '@chain/chain/wallet';
import {
  ALLOWANCE_MIN, FAUCET_AMOUNT, MIN_SIZE, REVERT_TEXT, approveCall, assetLabel, buyCall, claimCall, closeCall, depositCall, faucetCall, maxPremium, minProceeds,
  poolCall, redeemCall, scaleFee, seriesLabel,
} from '@chain/chain/trade';
import { useChain } from './provider';
import { userView, type UserView } from './selectors';

export const DEBOUNCE_MS = 250;

/** Parse desimal pengguna → bigint dengan `decimals`; null bila kosong/invalid/≤ 0 (helper `parse` panel klasik). */
export function parseAmount(v: string, decimals: number): bigint | null {
  const t = v.trim();
  if (t === '') return null;
  try { const x = parseUnits(t, decimals); return x > 0n ? x : null; } catch { return null; }
}

/** Hasil pratinjau: `value` terakhir yang valid, `error` (pesan guard/revert), `loading` = permintaan baru sedang menunggu debounce/RPC. */
export interface Preview<T> { value: T | null; error: string | null; loading: boolean }
/** Kuotasi view = INDIKATIF (round terakhir yang diobservasi engine); `exec`/`feeExec`/`maxPremium` = jalur eksekusi (post-poke) bila ada akun dan simulasi lolos. */
export interface BuyPreview { premium: bigint; fee: bigint; sigma: bigint; delta: bigint; vega: bigint; exec: bigint | null; feeExec: bigint | null; maxPremium: bigint | null }
export interface ClosePreview { proceeds: bigint; sigma: bigint; exec: bigint | null; minProceeds: bigint | null }
export interface Previews { deposit: Preview<bigint>; redeem: Preview<bigint>; buy: Preview<BuyPreview>; close: Preview<ClosePreview> }
export interface ClaimPreview { units: bigint; payoutPerUnit: bigint; payout: bigint }
type Field = keyof Previews;
const idle = <T,>(): Preview<T> => ({ value: null, error: null, loading: false });

export interface TradeApi {
  previews: Previews;
  /** Pratinjau (debounce 250 ms; balasan lama tidak pernah menimpa yang baru). `series` = indeks global di ALL_SERIES; `acct` default = akun terhubung. */
  preview: {
    deposit(k: PoolKey, assets: bigint | null): void;
    redeem(k: PoolKey, shares: bigint | null): void;
    buy(k: PoolKey, series: number | null, size: bigint | null, acct?: Address | null): void;
    close(k: PoolKey, series: number | null, size: bigint | null, acct?: Address | null): void;
  };
  /** Pratinjau klaim (murni dari snapshot): units × payoutPerUnit / 1e18 / 1e12; null tanpa posisi/akun. */
  claimPreview(k: PoolKey, series: number | null): ClaimPreview | null;
  /** Aksi wallet. Mengembalikan pesan guard (tidak ada yang dikirim) atau null bila aksi diserahkan ke ChainState.run (hasil lewat busy/txLog). */
  actions: {
    faucet(k: PoolKey): string | null;
    approve(k: PoolKey): string | null;
    deposit(k: PoolKey, assets: bigint | null): string | null;
    redeem(k: PoolKey, shares: bigint | null): string | null;
    buy(k: PoolKey, series: number | null, size: bigint | null): string | null;
    close(k: PoolKey, series: number | null, size: bigint | null): string | null;
    claim(k: PoolKey, series: number | null): string | null;
  };
  /** Data akun dari snapshot (null tanpa wallet) — bahan select posisi/klaim dan tombol approve (`approved[k]`). */
  user: UserView | null;
  /** Tombol approve ditampilkan bila allowance[k] < ALLOWANCE_MIN. */
  needsApprove(k: PoolKey): boolean;
}

export function useTrade(): TradeApi {
  const { client, snapshot, account, run } = useChain();
  const user = useMemo(() => userView(snapshot, account), [snapshot, account]);
  // Nilai terbaru untuk closure async (pratinjau yang jalan setelah debounce membaca akun/snapshot saat itu, bukan saat diminta).
  const latest = useRef({ client, snapshot, account, user, run });
  latest.current = { client, snapshot, account, user, run };
  const [previews, setPreviews] = useState<Previews>({ deposit: idle(), redeem: idle(), buy: idle(), close: idle() });
  const seq = useRef<Record<Field, number>>({ deposit: 0, redeem: 0, buy: 0, close: 0 });
  const timers = useRef<Partial<Record<Field, ReturnType<typeof setTimeout>>>>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const t of Object.values(timers.current)) clearTimeout(t); }; }, []);

  const set = useCallback(<F extends Field>(f: F, n: number, p: Previews[F]) => {
    // Penjaga urutan: hanya balasan permintaan terbaru per field yang boleh menulis (balasan lama dibuang).
    if (!mounted.current || n !== seq.current[f]) return;
    setPreviews((prev) => ({ ...prev, [f]: p }));
  }, []);
  /** Setiap permintaan menaikkan nomor urut, menandai loading (nilai lama dipertahankan), lalu menjadwalkan fn setelah DEBOUNCE_MS. */
  const schedule = useCallback((f: Field, fn: (n: number) => void | Promise<void>) => {
    const n = ++seq.current[f];
    clearTimeout(timers.current[f]);
    setPreviews((prev) => ({ ...prev, [f]: { ...prev[f], loading: true } }));
    timers.current[f] = setTimeout(() => { void fn(n); }, DEBOUNCE_MS);
  }, []);

  const preview = useMemo<TradeApi['preview']>(() => ({
    deposit: (k, assets) => schedule('deposit', async (n) => {
      if (!assets) return set('deposit', n, idle());
      try { const sh = await latest.current.client.readContract({ ...poolCall(k), functionName: 'previewDeposit', args: [assets] }); set('deposit', n, { value: sh, error: null, loading: false }); }
      catch (e) { set('deposit', n, { value: null, error: decodeRevert(e), loading: false }); }
    }),
    redeem: (k, shares) => schedule('redeem', async (n) => {
      if (!shares) return set('redeem', n, idle());
      try { const a = await latest.current.client.readContract({ ...poolCall(k), functionName: 'previewRedeem', args: [shares] }); set('redeem', n, { value: a, error: null, loading: false }); }
      catch (e) { set('redeem', n, { value: null, error: decodeRevert(e), loading: false }); }
    }),
    // Kuotasi view (indikatif) + simulasi jalur eksekusi bila ada akun; simulasi yang gagal (belum approve/tanpa USDG/429) TIDAK menutupi kuotasi indikatif.
    buy: (k, series, size, acct) => schedule('buy', async (n) => {
      const ref = series === null ? undefined : ALL_SERIES[series];
      if (!ref || !size) return set('buy', n, idle());
      if (size < MIN_SIZE) return set('buy', n, { value: null, error: 'minimum size is 0.01 units', loading: false });
      const a = acct === undefined ? latest.current.account : acct;
      const id = ref.id[k];
      try {
        const [q, exec] = await Promise.all([
          latest.current.client.readContract({ ...poolCall(k), functionName: 'quoteBuy', args: [id, size] }),
          a ? executedBuy(k, id, size, a).catch(() => null) : Promise.resolve(null),
        ]);
        const feeExec = exec === null ? null : scaleFee(q.feeAssets, q.premiumAssets, exec);
        set('buy', n, { loading: false, error: null, value: {
          premium: q.premiumAssets, fee: q.feeAssets, sigma: q.sigma, delta: q.delta, vega: q.vegaTotal,
          exec, feeExec, maxPremium: exec === null || feeExec === null ? null : maxPremium(exec, feeExec),
        } });
      } catch (e) { set('buy', n, { value: null, error: decodeRevert(e), loading: false }); }
    }),
    close: (k, series, size, acct) => schedule('close', async (n) => {
      const ref = series === null ? undefined : ALL_SERIES[series];
      if (!ref || !size) return set('close', n, idle());
      const a = acct === undefined ? latest.current.account : acct;
      const pos = latest.current.user?.user.positions[k][series!] ?? 0n;
      if (size > pos) return set('close', n, { value: null, error: `size exceeds position (${wad(pos, 2)})`, loading: false });
      const id = ref.id[k];
      try {
        const [[proceeds, sigma], exec] = await Promise.all([
          latest.current.client.readContract({ ...poolCall(k), functionName: 'quoteClose', args: [id, size] }),
          a ? executedClose(k, id, size, a).catch(() => null) : Promise.resolve(null),
        ]);
        set('close', n, { loading: false, error: null, value: { proceeds, sigma, exec, minProceeds: exec === null ? null : minProceeds(exec) } });
      } catch (e) { set('close', n, { value: null, error: decodeRevert(e), loading: false }); }
    }),
  }), [schedule, set]);

  const claimPreview = useCallback((k: PoolKey, series: number | null): ClaimPreview | null => {
    const s = snapshot, u = user;
    if (series === null || !s || !u) return null;
    const units = u.user.positions[k][series] ?? 0n, payoutPerUnit = s.series[series]?.[k].payoutPerUnit ?? 0n;
    if (units === 0n) return null;
    // payoutPerUnit WAD per unit × posisi WAD → aset 6 dp: ÷ 1e18 (unit) ÷ 1e12 (assetScale).
    return { units, payoutPerUnit, payout: (units * payoutPerUnit) / 10n ** 18n / 10n ** 12n };
  }, [snapshot, user]);

  // Setiap aksi menangkap pool SAAT KLIK (k) dan menjalankan guard ukuran SEBELUM RPC apa pun; akun ditangkap oleh run() sinkron pada saat yang sama.
  const actions = useMemo<TradeApi['actions']>(() => {
    const noAccount = () => (latest.current.account ? null : 'connect a wallet first');
    return {
      faucet: (k) => {
        // Faucet hanya untuk aset ber-mint terbuka (MockUSDG di A/B); USDG Paxos (C) tidak punya mint — tautan faucet.paxos.com, tanpa panggilan on-chain.
        if (POOLS[k].faucet !== 'mint') return `${assetLabel(k)} has no open mint — get 100 USDG per wallet per day at ${PAXOS_FAUCET}`;
        const g = noAccount(); if (g) return g;
        void latest.current.run(`faucet ${usdg(FAUCET_AMOUNT, 0)} USDG (mock)`, (kk, a) => faucetCall(kk, a), k);
        return null;
      },
      approve: (k) => {
        const g = noAccount(); if (g) return g;
        // approve(pool, MAX) pada ASET pool k (POOLS[k].asset): MockUSDG di A/B, USDG Paxos di C.
        void latest.current.run(`approve ${assetLabel(k)} for ${k}`, (kk) => approveCall(kk), k);
        return null;
      },
      deposit: (k, assets) => {
        const g = noAccount(); if (g) return g;
        if (!assets) return 'enter a USDG amount';
        void latest.current.run(`deposit ${usdg(assets)} USDG into ${k}`, (kk, a) => depositCall(kk, assets, a), k);
        return null;
      },
      redeem: (k, shares) => {
        const g = noAccount(); if (g) return g;
        if (!shares) return 'enter a share amount';
        void latest.current.run(`redeem ${usdg6(shares)} shares from ${k}`, (kk, a) => redeemCall(kk, shares, a), k);
        return null;
      },
      buy: (k, series, size) => {
        const g = noAccount(); if (g) return g;
        const ref = series === null ? undefined : ALL_SERIES[series];
        if (!ref || !size) return 'pick a series and a size';
        if (size < MIN_SIZE) return REVERT_TEXT.SizeTooSmall!;
        // Batas dari JALUR EKSEKUSI tepat sebelum tulis: premi = simulasi `buy(id, size, MAX_UINT)` (post-poke, round Chainlink terbaru), fee diskalakan
        // dari rasio kuotasi view; maxPremium = (premi + fee) × 1,01. Kuotasi view saja bisa gagal SlippageExceeded bila engine lama tidak di-poke (I-1).
        void latest.current.run(`buy ${wad(size, 2)} ${seriesLabel(ref)} on ${k}`, async (kk, a) => {
          const q = await latest.current.client.readContract({ ...poolCall(kk), functionName: 'quoteBuy', args: [ref.id[kk], size] });
          const premExec = await executedBuy(kk, ref.id[kk], size, a);
          return buyCall(kk, ref.id[kk], size, premExec, scaleFee(q.feeAssets, q.premiumAssets, premExec));
        }, k);
        return null;
      },
      close: (k, series, size) => {
        const g = noAccount(); if (g) return g;
        const ref = series === null ? undefined : ALL_SERIES[series];
        if (!ref || !size) return 'pick a position and a size';
        const pos = latest.current.user?.user.positions[k][series!] ?? 0n;
        if (size > pos) return `size exceeds your position (${wad(pos, 2)} units)`;
        // minProceeds = proceeds eksekusi (simulasi `close(id, size, 0)`, post-poke) × 0,99 — bukan dari `quoteClose` (I-1).
        void latest.current.run(`close ${wad(size, 2)} ${seriesLabel(ref)} on ${k}`, async (kk, a) => closeCall(kk, ref.id[kk], size, await executedClose(kk, ref.id[kk], size, a)), k);
        return null;
      },
      claim: (k, series) => {
        const g = noAccount(); if (g) return g;
        const ref = series === null ? undefined : ALL_SERIES[series];
        const pos = ref ? (latest.current.user?.user.positions[k][series!] ?? 0n) : 0n;
        if (!ref || pos === 0n) return 'nothing to claim';
        void latest.current.run(`claim ${wad(pos, 2)} ${seriesLabel(ref)} on ${k}`, (kk) => claimCall(kk, ref.id[kk], pos), k);
        return null;
      },
    };
  }, []);

  const needsApprove = useCallback((k: PoolKey) => user !== null && user.user.allowance[k] < ALLOWANCE_MIN, [user]);
  return { previews, preview, claimPreview, actions, user, needsApprove };
}
