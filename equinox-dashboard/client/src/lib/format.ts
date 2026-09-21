// format.ts — pelengkap tipis di atas `@chain/ui/format` (brief §8.3): hanya pengelompokan ribuan dan konversi bps → persen.
// Tidak ada matematika harga: semua angka datang dari snapshot/selector, di sini hanya diberi format.
import { feedUsd, utc } from '@chain/ui/format';
import { WAD, type SeriesRef } from '@chain/deployment';

/** Feed Chainlink (8 dp) → "2,579.49": digit persis `feedUsd` (toFixed 2), ditambah pemisah ribuan. */
export const usd = (answer: bigint) => Number(feedUsd(answer)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Basis poin `cfg()` → persen: 500 → "5 %", 8000 → "80 %", 5 → "0.05 %". */
export const bpsPct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`;
/** Satuan gas dengan pemisah ribuan; null (estimasi gagal) → "—". */
export const gasUnits = (g: bigint | null) => (g === null ? '—' : Number(g).toLocaleString('en-US'));
/** WAD tepat (18 dp, tanpa pembulatan float) — untuk selisih paritas K5 yang akan hilang pada 6 dp (brief §7.5: pembulatan tidak boleh menyembunyikan selisih). */
export const wadExact = (x: bigint) => { const neg = x < 0n, a = neg ? -x : x; return `${neg ? '-' : ''}${a / WAD}.${(a % WAD).toString().padStart(18, '0')}`; };
/** Label seri pendek tanpa tanggal: `C 2800 #0` (label bertanggal = `seriesLabel` dari `@chain/chain/trade`). */
export const refLabel = (r: SeriesRef) => `${r.isCall ? 'C' : 'P'} ${r.strike} #${r.boardId}`;
/** ISO build time (`__BUILD_TIME__`) → "2026-09-21 08:30 UTC"; string yang tidak bisa diurai dibiarkan apa adanya. */
export const buildStamp = (iso: string) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? utc(Math.floor(ms / 1000)) : iso; };
