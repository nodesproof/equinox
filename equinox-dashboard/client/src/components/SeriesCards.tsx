// SeriesCards.tsx — daftar kartu per seri untuk telepon (≤ 640 px), menggantikan tabel 13 kolom: baris 1 pill C/P + label pendek `C 2400 #0`
// (tanggal sudah di header board) + chip status + titik ATM; baris 2 kuotasi Buy 1 unit per pool (satu sel per pool, atau satu sel status gabungan);
// baris 3 paritas K5 + Δ A|B + σ_buy; aksi Trade + "Details" (SeriesDetail yang sama dengan tabel). Setiap teks datang dari helper yang SAMA dengan
// tabel (lib/boards.ts: buyCell/sharedStatus/quoteCell/deltaCell/parityCell/sigmaCell) — angka, status dan paritas identik, tidak ada hitungan di sini.
import { ChevronDown } from 'lucide-react';
import { POOL_KEYS } from '@chain/deployment';
import { seriesLabel } from '@chain/chain/trade';
import type { SeriesView } from '@/chain/selectors';
import { SeriesDetail } from '@/components/SeriesDetail';
import { StatusPill, keepSymbols } from '@/components/primitives';
import { DEFAULT_TRADE_POOL, K0, STATUS_TONE, buyCell, deltaCell, hasDeltaPair, parityCell, quoteCell, sharedStatus, sigmaCell, statusText, type BuyCell } from '@/lib/boards';
import { refLabel } from '@/lib/format';
import { tradeHref } from '@/lib/route';

export type SeriesCardsVariant = 'full' | 'summary';

export interface SeriesCardsProps {
  rows: SeriesView[];
  /** `full` (Boards): sel Buy = buyCell/sharedStatus (REVERT_TEXT manusiawi), Δ A|B, aksi Trade + Details;
   *  `summary` (Overview): sel Buy = quoteCell (nama revert mentah, seperti tabel ringkas), paritas + σ_buy saja. */
  variant: SeriesCardsVariant;
  /** Seri yang detailnya terbuka (indeks global) — state milik BoardTable agar bertahan saat lebar layar berganti tabel ↔ kartu. */
  expanded?: ReadonlySet<number>;
  onToggle?: (i: number) => void;
}

/** Sel Buy per pool untuk kartu: varian penuh memakai buyCell (+ gabungan sharedStatus), varian ringkas quoteCell (digabung hanya bila semua pool
 *  memberi teks status yang sama — teksnya tetap persis quoteCell). */
function quoteCells(r: SeriesView, variant: SeriesCardsVariant): { shared: BuyCell | null; cells: BuyCell[] } {
  if (variant === 'full') return { shared: sharedStatus(r), cells: POOL_KEYS.map((k) => buyCell(r, k)) };
  const cells = POOL_KEYS.map((k) => ({ kind: r.state[k].buy ? 'quote' : 'status', text: quoteCell(r, k), name: null } as BuyCell));
  const first = cells[0]!;
  return { shared: cells.every((c) => c.kind === 'status' && c.text === first.text) ? first : null, cells };
}

function SeriesCard({ r, variant, open, onToggle }: { r: SeriesView; variant: SeriesCardsVariant; open: boolean; onToggle?: (i: number) => void }) {
  const status = r.status[K0];
  const label = seriesLabel(r.ref);
  const { shared, cells } = quoteCells(r, variant);
  const parity = parityCell(r), delta = deltaCell(r);
  return (
    <li className={`series-card ${r.atm ? 'series-card--atm' : ''} ${open ? 'series-card--open' : ''}`} data-series={r.i} data-status={status}>
      <div className="series-card__head">
        <span className={`option-pill option-pill--${r.ref.isCall ? 'c' : 'p'}`}>{r.ref.isCall ? 'C' : 'P'}</span>
        <strong className="series-card__label mono" title={label}>{r.atm ? <span className="atm-dot" title="ATM — nearest strike to spot on the nearest open board" /> : null}{refLabel(r.ref)}</strong>
        <StatusPill tone={STATUS_TONE[status]}>{statusText(status)}</StatusPill>
      </div>
      <div className="series-card__quotes" data-cols={shared ? 1 : POOL_KEYS.length}>
        {shared
          ? <div className="series-card__quote series-card__quote--wide"><span>Buy {POOL_KEYS.join(' · ')}</span><em className="quote-status" title={shared.name ?? undefined}>{shared.text}</em></div>
          : POOL_KEYS.map((k, i) => {
            const c = cells[i]!;
            return (
              <div key={k} className="series-card__quote">
                <span>Buy {k}</span>
                {c.kind === 'quote' ? <b className="mono">{c.text}</b> : <em className="quote-status" title={c.name ?? undefined}>{c.text}</em>}
              </div>
            );
          })}
      </div>
      <dl className="series-card__meta">
        <div><dt>{variant === 'full' ? 'Parity' : 'Parity A|B'}</dt><dd><span className={`parity ${parity.state === 'pending' ? 'pending' : ''}`} data-parity={parity.state}>{parity.text}</span></dd></div>
        {variant === 'full' && hasDeltaPair()
          ? <div><dt>{keepSymbols('Δ A|B')}</dt><dd className={`mono ${delta.same === true ? 'delta-same' : delta.same === null ? 'muted-text' : ''}`} data-delta={delta.same === null ? 'none' : delta.same ? 'same' : 'diff'}>{delta.text}</dd></div>
          : null}
        <div><dt>{keepSymbols(`σ_buy ${POOL_KEYS.join(' | ')}`)}</dt><dd className="mono">{sigmaCell(r)}</dd></div>
      </dl>
      {variant === 'full' ? (
        <div className="series-card__actions">
          <a className="soft-button" href={tradeHref(DEFAULT_TRADE_POOL, r.i)} title={`Open Trade with Pool ${DEFAULT_TRADE_POOL} and ${label} selected`}>Trade</a>
          {/* Nama aksesibel diawali teks yang terlihat ("Details") — WCAG 2.5.3 label-in-name; sisanya menjelaskan seri seperti tombol expand tabel. */}
          <button type="button" className={`soft-button series-card__toggle ${open ? 'is-open' : ''}`} aria-expanded={open} aria-controls={`series-detail-${r.i}`}
            aria-label={`Details · ${open ? 'hide' : 'show'} Greeks for ${label}`} onClick={() => onToggle?.(r.i)}>Details <ChevronDown size={14} aria-hidden="true" /></button>
        </div>
      ) : null}
      {open ? <div className="series-detail series-card__detail" id={`series-detail-${r.i}`}><SeriesDetail row={r} /></div> : null}
    </li>
  );
}

export function SeriesCards({ rows, variant, expanded, onToggle }: SeriesCardsProps) {
  return (
    <ul className={`series-cards series-cards--${variant}`} aria-label="Series">
      {rows.map((r) => <SeriesCard key={r.i} r={r} variant={variant} open={expanded?.has(r.i) ?? false} onToggle={onToggle} />)}
    </ul>
  );
}
