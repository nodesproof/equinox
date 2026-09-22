// boards.ts — helper murni halaman Boards: teks sel per kolom persis semantik `web/src/panels/board.ts` (Buy/status, Δ A|B = relDiff atau '=',
// Close, Parity ✓/✗/—/…, OI 2 dp, σ_buy A | B | C 4 dp), filter bar, dan catatan kaki. Tidak ada matematika harga: semua angka dari snapshot/selector.
import { GAS_KEYS, POOL_KEYS, type PoolKey } from '@chain/deployment';
import { fmtCountdown, relDiff, usdg6, wad } from '@chain/ui/format';
import { REVERT_TEXT } from '@chain/chain/trade';
import { ASSET_SCALE, T_MIN, type BoardView, type SeriesStatus, type SeriesView } from '@/chain/selectors';
import type { PillTone } from '@/components/primitives';

/** Pool pertama = sumber status baris (semua pool mendaftar board yang sama) — board.ts `k0`. */
export const K0: PoolKey = POOL_KEYS[0]!;
/** Pool tujuan tombol "Trade" baris: Pool B (Equinox Stylus, pool unggulan brief — contoh tautan `#/trade?pool=B`) bila ada, selain itu pool pertama. */
export const DEFAULT_TRADE_POOL: PoolKey = POOL_KEYS.find((k) => k === 'B') ?? K0;
/** Δ dan Parity selalu A (Solidity) vs B (Stylus) — GAS_KEYS; kolomnya kosong ('—') bila salah satu pool tidak ada di manifest. */
const [DELTA_A, DELTA_B] = GAS_KEYS;
export const hasDeltaPair = () => POOL_KEYS.includes(DELTA_A) && POOL_KEYS.includes(DELTA_B);

// ---------------------------------------------------------------- header board

/** Nada pill per status seri/pool (SeriesDetail, Portfolio, kartu seri). */
export const STATUS_TONE: Record<SeriesStatus, PillTone> = { open: 'good', blackout: 'warn', expired: 'warn', settled: 'gold' };
/** Teks status seri untuk chip: `expired` selalu dijelaskan "awaiting settle". */
export const statusText = (status: SeriesStatus) => (status === 'expired' ? 'expired — awaiting settle' : status);

/** Pill status board: `text` versi penuh (desktop), `short` versi telepon ≤ 2 baris (countdown tanpa kalimat; settled = satu harga bila semua pool sama). */
export function boardPill(b: BoardView): { tone: PillTone; text: string; short: string } {
  switch (b.status) {
    case 'open': { const left = fmtCountdown(b.secondsToExpiry); return { tone: 'good', text: `open · expires in ${left} (block time)`, short: `open · ${left}` }; }
    case 'blackout': return { tone: 'warn', text: `blackout · ≤ ${T_MIN} s to expiry`, short: `blackout · ≤ ${T_MIN} s` };
    case 'expired': return { tone: 'warn', text: 'expired — awaiting settle', short: 'expired · awaiting settle' };
    case 'settled': {
      const prices = POOL_KEYS.map((k) => wad(b.settled[k].settlementPrice, 2));
      const same = prices.every((p) => p === prices[0]);
      return { tone: 'gold', text: `settled @ ${POOL_KEYS.map((k, i) => `${prices[i]} (${k})`).join(' / ')}`, short: same ? `settled @ ${prices[0]}` : `settled @ ${prices.join(' / ')}` };
    }
  }
}

/** Teks sel Buy ringkas (Overview): premi 1 unit, atau ALASAN kuotasi kosong — nama revert mentah, bukan kalimat (brief §5: jangan pernah kosong). */
export function quoteCell(r: SeriesView, k: PoolKey): string {
  const st = r.state[k];
  if (st.buy) return usdg6(st.buy.premium);
  if (st.settled) return `settled @ ${usdg6(st.payoutPerUnit / ASSET_SCALE)}/unit`;
  const status = r.status[k];
  if (status === 'blackout') return 'blackout';
  if (status === 'expired') return 'expired — awaiting settle';
  return st.buyError ?? '—';
}

// ---------------------------------------------------------------- sel

export interface BuyCell {
  /** `quote` = premi 1 unit (6 dp); `status` = alasan kuotasi kosong (brief §5: jangan pernah kosong). */
  kind: 'quote' | 'status';
  text: string;
  /** Nama revert mentah (`buyError`) bila ada — ditampilkan sebagai title agar nama kontraknya tetap terlihat. */
  name: string | null;
}
/** Sel Buy k: premi, atau status berurutan settled @ payout → blackout → expired → nama revert manusiawi (REVERT_TEXT) / nama mentah. */
export function buyCell(r: SeriesView, k: PoolKey): BuyCell {
  const st = r.state[k];
  if (st.buy) return { kind: 'quote', text: usdg6(st.buy.premium), name: null };
  if (st.settled) return { kind: 'status', text: `settled @ ${usdg6(st.payoutPerUnit / ASSET_SCALE)}/unit`, name: st.buyError };
  const status = r.status[k];
  if (status === 'blackout') return { kind: 'status', text: 'blackout', name: st.buyError };
  if (status === 'expired') return { kind: 'status', text: 'expired — awaiting settle', name: st.buyError };
  if (st.buyError) return { kind: 'status', text: REVERT_TEXT[st.buyError] ?? st.buyError, name: st.buyError };
  return { kind: 'status', text: '—', name: null };
}
/** Bila SEMUA pool tanpa kuotasi dengan teks status yang sama → satu sel gabungan (colSpan) seperti board.ts yang menulis status sekali; selain itu null. */
export function sharedStatus(r: SeriesView): BuyCell | null {
  const cells = POOL_KEYS.map((k) => buyCell(r, k));
  const first = cells[0]!;
  return cells.every((c) => c.kind === 'status' && c.text === first.text) ? first : null;
}

export interface DeltaCell { text: string; /** true = premi A dan B identik ('='); false = berbeda (relDiff); null = tidak ada pasangan kuotasi. */ same: boolean | null }
/** Δ A|B (board.ts): '=' bila premi identik, selain itu |A−B|/max; '—' tanpa pasangan kuotasi. Inventaris, bukan matematika. */
export function deltaCell(r: SeriesView): DeltaCell {
  if (!hasDeltaPair()) return { text: '—', same: null };
  const a = r.state[DELTA_A]?.buy, b = r.state[DELTA_B]?.buy;
  if (!a || !b) return { text: '—', same: null };
  return a.premium === b.premium ? { text: '=', same: true } : { text: relDiff(a.premium, b.premium), same: false };
}

export type ParityState = 'ok' | 'bad' | 'none' | 'pending';
export interface ParityCell { text: '✓' | '✗' | '—' | '…'; state: ParityState }
/** Parity K5 (board.ts): '…' sebelum readParity, '—' bila salah satu math gagal / seri tidak hidup, ✓/✗ selain itu. */
export function parityCell(r: SeriesView): ParityCell {
  if (r.parity === null) return { text: '…', state: 'pending' };
  if (r.parity.ok === null) return { text: '—', state: 'none' };
  return r.parity.ok ? { text: '✓', state: 'ok' } : { text: '✗', state: 'bad' };
}

/** Close k: hasil quoteClose(1 unit) 6 dp, '—' bila view revert. */
export const closeCell = (r: SeriesView, k: PoolKey) => (r.state[k].close !== null ? usdg6(r.state[k].close!) : '—');
/** OI k: unit terbuka (WAD) 2 dp. */
export const oiCell = (r: SeriesView, k: PoolKey) => wad(r.state[k].oi, 2);
/** σ_buy per pool (4 dp) dipisah ' | ' dalam urutan POOL_KEYS; '—' bila tidak ada satu pun kuotasi. */
export const sigmaCell = (r: SeriesView) => (POOL_KEYS.some((k) => r.state[k].buy) ? POOL_KEYS.map((k) => (r.state[k].buy ? wad(r.state[k].buy!.sigma) : '—')).join(' | ') : '—');

// ---------------------------------------------------------------- filter

export type TypeFilter = 'all' | 'C' | 'P';
export interface BoardFilter {
  /** null = semua board; selain itu id board manifest. */
  board: number | null;
  type: TypeFilter;
  /** Hanya seri yang masih bisa ditransaksikan di salah satu pool (status `open`). */
  openOnly: boolean;
}
export const DEFAULT_FILTER: BoardFilter = { board: null, type: 'all', openOnly: false };
/** Seri terbuka = status `open` di salah satu pool (settle per pool bisa berbeda beberapa blok). */
export const isOpenSeries = (r: SeriesView) => POOL_KEYS.some((k) => r.status[k] === 'open');
export function filterSeries(rows: SeriesView[], f: BoardFilter): SeriesView[] {
  return rows.filter((r) => (f.type === 'all' || (f.type === 'C') === r.ref.isCall) && (!f.openOnly || isOpenSeries(r)));
}

// ---------------------------------------------------------------- catatan kaki

/** Kalimat catatan kaki board klasik (`web/src/panels/board.ts`), kalimat Pool C hanya bila pool C ada di manifest (brief §7.9). */
export function boardNote(): string[] {
  const note = [
    'Quotes are per 1.0 unit at each pool\'s own inventory (σ_mark(util)); Δ is inventory, not math.',
    'Parity ✓ = both math contracts (Solidity control vs Stylus) return byte-identical prices for identical inputs (S, K, t, σ_mark(0)) at this block — K5.',
    'Gas = eth_estimateGas of buy(1 unit) from the seed-LP wallet; σ is computed by the shared engine, so the A/B difference is the two pricing calls (Stylus program cached).',
  ];
  if (POOL_KEYS.includes('C')) note.push('Pool C: same Stylus math and engine as B, settled in Paxos USDG (testnet); its inventory term (σ_mark(util)) follows its own pool size.');
  return note;
}
